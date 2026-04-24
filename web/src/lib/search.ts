"use server";

import fs from "fs";
import path from "path";
import matter from "gray-matter";

const OBSIDIAN_DIR = path.join(process.cwd(), "..", "obsidian");

const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
]);

const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

export interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchResult {
  filePath: string;
  slug: string;
  title: string;
  matches: SearchMatch[];
}

function parseMarkdownFile(raw: string) {
  try {
    return matter(raw);
  } catch {
    // Keep search resilient when a file has malformed frontmatter.
    const content = raw.startsWith("---")
      ? raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "")
      : raw;

    return { data: {} as Record<string, unknown>, content };
  }
}

function getAllMarkdownFiles(
  dir: string = OBSIDIAN_DIR,
  basePath: string = ""
): { filePath: string; slug: string }[] {
  const files: { filePath: string; slug: string }[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const slug = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...getAllMarkdownFiles(fullPath, slug));
    } else if (entry.name.endsWith(".md")) {
      files.push({
        filePath: fullPath,
        slug: slug.replace(/\.md$/, ""),
      });
    }
  }

  return files;
}

export async function searchMarkdown(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) return [];

  const searchTerm = query.trim();
  const regex = new RegExp(escapeRegex(searchTerm), "gi");
  const files = getAllMarkdownFiles();
  const results: SearchResult[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(file.filePath, "utf-8");
    const { data, content } = parseMarkdownFile(raw);
    const frontmatter = data as { title?: string };
    const lines = content.split("\n");
    const matches: SearchMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpExecArray | null;
      regex.lastIndex = 0;

      while ((match = regex.exec(line)) !== null) {
        matches.push({
          lineNumber: i + 1,
          lineContent: line,
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
        });
        break; // one match per line is enough
      }
    }

    if (matches.length > 0) {
      const h1Match = content.match(/^#\s+(.+)$/m);
      const title =
        frontmatter.title ||
        h1Match?.[1] ||
        file.slug.split("/").pop() ||
        file.slug;

      results.push({
        filePath: file.slug,
        slug: file.slug,
        title,
        matches,
      });
    }
  }

  // Sort by number of matches descending
  results.sort((a, b) => b.matches.length - a.matches.length);

  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
