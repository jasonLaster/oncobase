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
const _fileCache = new Map<string, MarkdownFile | null>();
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
      const nameWithoutExt = entry.name.replace(/\.pdf$/, "");
      const pdfPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      nodes.push({ name: nameWithoutExt, slug: pdfPath, type: "pdf", pdfPath });
    }
  }

  // Sort alphabetically regardless of type
  nodes.sort((a, b) => a.name.localeCompare(b.name));

  return nodes;
}

/** Read and parse a single markdown file */
export function getMarkdownFile(slug: string): MarkdownFile | null {
  if (_fileCache.has(slug)) return _fileCache.get(slug)!;

  const filePath = path.join(OBSIDIAN_DIR, `${slug}.md`);

  if (!fs.existsSync(filePath)) {
    _fileCache.set(slug, null);
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
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
  _fileCache.set(slug, result);
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
  return slugs;
}
