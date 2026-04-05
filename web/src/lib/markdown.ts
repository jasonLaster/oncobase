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
]);

const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

export interface FileNode {
  name: string;
  slug: string;
  type: "file" | "directory";
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
    }
  }

  // Sort: directories first, then files, alphabetically within each group
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

/** Read and parse a single markdown file */
export function getMarkdownFile(slug: string): MarkdownFile | null {
  const filePath = path.join(OBSIDIAN_DIR, `${slug}.md`);

  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  // Derive title from first H1, frontmatter, or filename
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = (data.title as string) || h1Match?.[1] || slug.split("/").pop() || slug;

  // Strip the leading H1 to avoid double title rendering
  const body = h1Match ? content.replace(/^#\s+.+$/m, "").replace(/^\n+/, "") : content;

  return { slug, title, content: body, frontmatter: data };
}

/** Get all unique tags across all markdown files */
export function getAllTags(): string[] {
  const tags = new Set<string>();
  const slugs = getAllSlugs();
  for (const slug of slugs) {
    const file = getMarkdownFile(slug);
    if (file && Array.isArray(file.frontmatter.tags)) {
      for (const tag of file.frontmatter.tags as string[]) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

/** Get all pages that have a given tag */
export function getPagesByTag(tag: string): { slug: string; title: string }[] {
  const slugs = getAllSlugs();
  const pages: { slug: string; title: string }[] = [];
  for (const slug of slugs) {
    const file = getMarkdownFile(slug);
    if (file && Array.isArray(file.frontmatter.tags)) {
      if ((file.frontmatter.tags as string[]).includes(tag)) {
        pages.push({ slug: file.slug, title: file.title });
      }
    }
  }
  return pages.sort((a, b) => a.title.localeCompare(b.title));
}

/** Get all markdown file slugs for static generation */
export function getAllSlugs(): string[] {
  const slugs: string[] = [];

  function walk(dir: string, basePath: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
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
  return slugs;
}
