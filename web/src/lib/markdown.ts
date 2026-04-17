import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const OBSIDIAN_DIR = path.join(process.cwd(), "..", "obsidian");

// Directories to exclude from the file tree
const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);

const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

// ── Module-level caches ───────────────────────────────────────────────────────
// Next.js static generation calls these functions repeatedly across workers.
// Memoizing here cuts tag-page generation from O(tags × slugs) file reads to
// O(slugs) — a ~425x reduction for the getPagesByTag scan.

let _slugsCache: string[] | null = null;
let _canonicalSlugsCache: Map<string, string> | null = null;
const _fileCache = new Map<string, { hash: string; result: MarkdownFile } | null>();
let _tagsCache: string[] | null = null;
const _tagPagesCache = new Map<string, Array<{ slug: string; title: string }>>();

export interface FileNode {
  name: string;
  slug: string;
  type: "file" | "directory" | "pdf";
  /** Relative path within obsidian/ — only set for type === "pdf" */
  pdfPath?: string;
  children?: FileNode[];
}

export interface MarkdownFile {
  slug: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

function buildCanonicalSlugMap(): Map<string, string> {
  if (_canonicalSlugsCache) return _canonicalSlugsCache;

  const canonicalSlugs = new Map<string, string>();
  for (const slug of getAllSlugs()) {
    const normalizedSlug = slug.toLowerCase();
    if (!canonicalSlugs.has(normalizedSlug)) {
      canonicalSlugs.set(normalizedSlug, slug);
    }
  }

  _canonicalSlugsCache = canonicalSlugs;
  return canonicalSlugs;
}

/** Build a tree of markdown files for the sidebar */
export function getFileTree(dir: string = OBSIDIAN_DIR, basePath: string = ""): FileNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const slug = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = getFileTree(fullPath, slug);
      if (children.length > 0) {
        nodes.push({ name: entry.name, slug, type: "directory", children });
      }
    } else if (entry.name.endsWith(".md")) {
      const nameWithoutExt = entry.name.replace(/\.md$/, "");
      const fileSlug = basePath ? `${basePath}/${nameWithoutExt}` : nameWithoutExt;
      nodes.push({ name: nameWithoutExt, slug: fileSlug, type: "file" });
    } else if (entry.name.endsWith(".pdf")) {
      // Skip Git LFS pointer files — they are tiny text files (< 200 bytes)
      const stat = fs.statSync(fullPath);
      if (stat.size < 200) continue;

      const nameWithoutExt = entry.name.replace(/\.pdf$/, "");
      const pdfPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      nodes.push({ name: nameWithoutExt, slug: pdfPath, type: "pdf", pdfPath });
    }
  }

  // Sort alphabetically regardless of type
  nodes.sort((a, b) => a.name.localeCompare(b.name));

  return nodes;
}

/**
 * Fetch PDF paths from Convex using the official SDK (fetchQuery).
 * Cached at build time so the sidebar includes PDFs even when they
 * aren't on disk (i.e. on Vercel).
 */
async function fetchConvexPdfPaths(): Promise<string[]> {
  "use cache";
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return [];
  try {
    const { fetchQuery } = await import("convex/nextjs");
    const { api } = await import("../../convex/_generated/api");
    const assets = await fetchQuery(api.documents.listPdfAssets, {});
    return assets.map((a: { path: string }) => a.path);
  } catch (err) {
    console.warn("[fetchConvexPdfPaths] Failed:", err);
    return [];
  }
}

/**
 * Build the file tree and merge in PDF entries from Convex.
 * On Vercel, PDFs aren't on disk — they live in Blob and are tracked in
 * the Convex pdfAssets table.  This function fetches those paths and
 * inserts them into the tree so the sidebar shows PDFs in prod.
 */
export async function getFileTreeWithPdfs(): Promise<FileNode[]> {
  const tree = getFileTree();

  // Collect PDF paths already discovered on disk
  const diskPdfs = new Set<string>();
  (function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.type === "pdf" && n.pdfPath) diskPdfs.add(n.pdfPath);
      if (n.children) walk(n.children);
    }
  })(tree);

  // Fetch PDF asset paths from Convex (cached at build time)
  const pdfPaths = await fetchConvexPdfPaths();
  if (pdfPaths.length === 0) return tree;

  let added = 0;
  for (const pdfPath of pdfPaths) {
    if (diskPdfs.has(pdfPath)) continue; // already in tree from disk

    const segments = pdfPath.split("/");
    const fileName = segments.pop()!;
    const nameWithoutExt = fileName.replace(/\.pdf$/, "");

    // Walk/create directory nodes to reach the parent folder
    let current = tree;
    for (const seg of segments) {
      let dir = current.find((n) => n.type === "directory" && n.name === seg);
      if (!dir) {
        dir = { name: seg, slug: segments.slice(0, segments.indexOf(seg) + 1).join("/"), type: "directory", children: [] };
        current.push(dir);
      }
      current = dir.children!;
    }

    current.push({
      name: nameWithoutExt,
      slug: pdfPath,
      type: "pdf",
      pdfPath,
    });
    added++;
  }

  // Re-sort any nodes we touched
  if (added > 0) {
    (function sortTree(nodes: FileNode[]) {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      for (const n of nodes) if (n.children) sortTree(n.children);
    })(tree);
    console.log(`[getFileTreeWithPdfs] Merged ${added} PDFs from Convex`);
  }

  return tree;
}

/** Read and parse a single markdown file (sync — for static generation) */
export function getMarkdownFile(slug: string): MarkdownFile | null {
  const filePath = path.join(OBSIDIAN_DIR, `${slug}.md`);

  if (!fs.existsSync(filePath)) {
    _fileCache.set(slug, null);
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  return parseMarkdownFile(slug, raw);
}

/** Read and parse a single markdown file (async — for page rendering) */
export async function getMarkdownFileAsync(slug: string): Promise<MarkdownFile | null> {
  const filePath = path.join(OBSIDIAN_DIR, `${slug}.md`);

  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return parseMarkdownFile(slug, raw);
  } catch {
    _fileCache.set(slug, null);
    return null;
  }
}

export function getCanonicalSlug(slug: string): string | null {
  return buildCanonicalSlugMap().get(slug.toLowerCase()) ?? null;
}

function parseMarkdownFile(slug: string, raw: string): MarkdownFile {
  const hash = createHash("md5").update(raw).digest("hex");

  // Return cached parse if the file hasn't changed
  const cached = _fileCache.get(slug);
  if (cached && cached.hash === hash) return cached.result;

  let data: Record<string, unknown> = {};
  let content = raw;
  try {
    ({ data, content } = matter(raw));
  } catch {
    // Malformed YAML frontmatter (e.g. `**bold:**` misread as YAML alias)
  }

  // Derive title from first H1, frontmatter, or filename
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = (data.title as string) || h1Match?.[1] || slug.split("/").pop() || slug;

  // Strip the leading H1 to avoid double title rendering
  const body = h1Match ? content.replace(/^#\s+.+$/m, "").replace(/^\n+/, "") : content;

  const result: MarkdownFile = { slug, title, content: body, frontmatter: data };
  _fileCache.set(slug, { hash, result });
  return result;
}

/** Get all unique tags across all markdown files */
export function getAllTags(): string[] {
  if (_tagsCache) return _tagsCache;
  const tags = new Set<string>();
  const slugs = getAllSlugs();
  for (const slug of slugs) {
    const file = getMarkdownFile(slug);
    if (file && Array.isArray(file.frontmatter.tags)) {
      for (const tag of file.frontmatter.tags as string[]) {
        tags.add(tag.toLowerCase());
      }
    }
  }
  _tagsCache = Array.from(tags).sort((a, b) => a.localeCompare(b));
  return _tagsCache;
}

/** Get all pages that have a given tag */
export function getPagesByTag(tag: string): { slug: string; title: string }[] {
  const normalizedTag = tag.toLowerCase();
  if (_tagPagesCache.has(normalizedTag)) return _tagPagesCache.get(normalizedTag)!;

  const slugs = getAllSlugs();
  const pages: { slug: string; title: string }[] = [];
  for (const slug of slugs) {
    const file = getMarkdownFile(slug);
    if (file && Array.isArray(file.frontmatter.tags)) {
      if ((file.frontmatter.tags as string[]).some((t) => t.toLowerCase() === normalizedTag)) {
        pages.push({ slug: file.slug, title: file.title });
      }
    }
  }
  const sorted = pages.sort((a, b) => a.title.localeCompare(b.title));
  _tagPagesCache.set(normalizedTag, sorted);
  return sorted;
}

/** Get all markdown file slugs for static generation */
export function getAllSlugs(): string[] {
  if (_slugsCache) return _slugsCache;

  const slugs: string[] = [];

  function walk(dir: string, basePath: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (EXCLUDED_FILES.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const slug = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(fullPath, slug);
      } else if (entry.name.endsWith(".md")) {
        slugs.push(slug.replace(/\.md$/, ""));
      }
    }
  }

  walk(OBSIDIAN_DIR, "");
  _slugsCache = slugs;
  _canonicalSlugsCache = null;
  return slugs;
}
