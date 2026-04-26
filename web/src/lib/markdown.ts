import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import {
  applyPiiRedactions,
  type PiiRedactionMode,
} from "@/lib/pii-redaction";

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
  badge?: string;
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

type CollectionPart = "markdown" | "analysis" | "pdf";

function getCollectionPart(node: FileNode): { baseName: string; part: CollectionPart } | null {
  if (node.type === "pdf") return { baseName: node.name, part: "pdf" };
  if (node.type !== "file") return null;
  if (node.name.endsWith("-analysis")) {
    return { baseName: node.name.replace(/-analysis$/, ""), part: "analysis" };
  }
  if (node.name.endsWith("-overview")) {
    return { baseName: node.name.replace(/-overview$/, ""), part: "analysis" };
  }
  return { baseName: node.name, part: "markdown" };
}

function getCollectionChildName(node: FileNode, part: CollectionPart): string {
  if (part === "pdf") return "PDF";
  if (part === "markdown") return "Markdown";
  if (node.name.endsWith("-overview")) return "Overview";
  return "Analysis";
}

function groupPaperCollections(nodes: FileNode[]): FileNode[] {
  const groups = new Map<string, Partial<Record<CollectionPart, FileNode[]>>>();

  for (const node of nodes) {
    const collectionPart = getCollectionPart(node);
    if (!collectionPart) continue;

    const group = groups.get(collectionPart.baseName) ?? {};
    const partNodes = group[collectionPart.part] ?? [];
    partNodes.push(node);
    group[collectionPart.part] = partNodes;
    groups.set(collectionPart.baseName, group);
  }

  const groupedNodes = new Set<FileNode>();
  const collectionNodes: FileNode[] = [];

  for (const [baseName, group] of groups) {
    if (!group.markdown?.length || !group.analysis?.length || !group.pdf?.length) {
      continue;
    }

    const children = [
      ...group.pdf.map((node) => ({ node, part: "pdf" as const })),
      ...group.analysis.map((node) => ({ node, part: "analysis" as const })),
      ...group.markdown.map((node) => ({ node, part: "markdown" as const })),
    ].map(({ node, part }) => {
      groupedNodes.add(node);
      return {
        ...node,
        name: getCollectionChildName(node, part),
      };
    });
    const firstChild = children[0];
    const parentSlug = firstChild.slug.includes("/") ? firstChild.slug.split("/").slice(0, -1).join("/") : "";

    collectionNodes.push({
      name: baseName,
      slug: parentSlug ? `${parentSlug}/${baseName}__paper-set` : `${baseName}__paper-set`,
      type: "directory",
      badge: "PDF set",
      children,
    });
  }

  if (collectionNodes.length === 0) return nodes;
  return [...nodes.filter((node) => !groupedNodes.has(node)), ...collectionNodes];
}

function groupPaperCollectionsDeep(nodes: FileNode[]): FileNode[] {
  const withGroupedChildren = nodes.map((node) => {
    if (!node.children) return node;
    return {
      ...node,
      children: groupPaperCollectionsDeep(node.children),
    };
  });

  return groupPaperCollections(withGroupedChildren);
}

function sortTree(nodes: FileNode[]) {
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

interface MarkdownReadOptions {
  piiMode?: PiiRedactionMode;
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
  const groupedNodes = groupPaperCollections(nodes);
  groupedNodes.sort((a, b) => a.name.localeCompare(b.name));

  return groupedNodes;
}

/**
 * Fetch PDF paths from Convex using the official SDK (fetchQuery).
 * Callers decide whether to cache the result; the navigation shell now
 * fetches the merged tree dynamically so newly ingested PDFs can appear
 * without being pinned into the PPR layout shell.
 */
async function fetchConvexPdfPaths(): Promise<string[]> {
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
    const groupedTree = groupPaperCollectionsDeep(tree);
    tree.splice(0, tree.length, ...groupedTree);
    sortTree(tree);
    console.log(`[getFileTreeWithPdfs] Merged ${added} PDFs from Convex`);
  }

  return tree;
}

/**
 * Resolve a slug to a concrete .md path on disk.
 *
 * `{slug}.md` wins; if that's missing, fall back to `{slug}/index.md` so a
 * directory landing page is reachable at the bare directory URL.
 */
function resolveSlugToFile(slug: string): { filePath: string; resolvedSlug: string } | null {
  const direct = path.join(OBSIDIAN_DIR, `${slug}.md`);
  if (fs.existsSync(direct)) return { filePath: direct, resolvedSlug: slug };
  const indexPath = path.join(OBSIDIAN_DIR, slug, "index.md");
  if (fs.existsSync(indexPath)) return { filePath: indexPath, resolvedSlug: `${slug}/index` };
  return null;
}

/** Read and parse a single markdown file (sync — for static generation) */
export function getMarkdownFile(
  slug: string,
  { piiMode = "redacted" }: MarkdownReadOptions = {}
): MarkdownFile | null {
  const cacheKey = `${piiMode}:${slug}`;
  const resolved = resolveSlugToFile(slug);
  if (!resolved) {
    _fileCache.set(cacheKey, null);
    return null;
  }
  const raw = fs.readFileSync(resolved.filePath, "utf-8");
  return parseMarkdownFile(resolved.resolvedSlug, raw, piiMode);
}

/** Read and parse a single markdown file (async — for page rendering) */
export async function getMarkdownFileAsync(
  slug: string,
  { piiMode = "redacted" }: MarkdownReadOptions = {}
): Promise<MarkdownFile | null> {
  const cacheKey = `${piiMode}:${slug}`;
  const resolved = resolveSlugToFile(slug);
  if (!resolved) {
    _fileCache.set(cacheKey, null);
    return null;
  }
  try {
    const raw = await fs.promises.readFile(resolved.filePath, "utf-8");
    return parseMarkdownFile(resolved.resolvedSlug, raw, piiMode);
  } catch {
    _fileCache.set(cacheKey, null);
    return null;
  }
}

export function getCanonicalSlug(slug: string): string | null {
  return buildCanonicalSlugMap().get(slug.toLowerCase()) ?? null;
}

function parseMarkdownFile(
  slug: string,
  raw: string,
  piiMode: PiiRedactionMode
): MarkdownFile {
  const cacheKey = `${piiMode}:${slug}`;
  const hash = createHash("md5").update(`${piiMode}:${raw}`).digest("hex");

  // Return cached parse if the file hasn't changed
  const cached = _fileCache.get(cacheKey);
  if (cached && cached.hash === hash) return cached.result;

  let data: Record<string, unknown> = {};
  let content = raw;
  try {
    ({ data, content } = matter(raw));
  } catch {
    // Malformed YAML frontmatter (e.g. `**bold:**` misread as YAML alias)
  }

  const sanitizedContent = applyPiiRedactions(content, { mode: piiMode });

  // Derive title from first H1, frontmatter, or filename
  const h1Match = sanitizedContent.match(/^#\s+(.+)$/m);
  const title = (data.title as string) || h1Match?.[1] || slug.split("/").pop() || slug;

  // Strip the leading H1 to avoid double title rendering
  const body = h1Match
    ? sanitizedContent.replace(/^#\s+.+$/m, "").replace(/^\n+/, "")
    : sanitizedContent;

  const result: MarkdownFile = { slug, title, content: body, frontmatter: data };
  _fileCache.set(cacheKey, { hash, result });
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
    const hasIndexMd = entries.some((e) => e.isFile() && e.name === "index.md");
    if (hasIndexMd && basePath) {
      // Expose the directory itself as a slug so /foo/bar resolves to foo/bar/index.md.
      slugs.push(basePath);
    }
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
