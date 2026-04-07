/**
 * Ingest all wiki markdown files into Convex documents table.
 * Uses content hashes to skip unchanged files.
 *
 * Usage: npx tsx scripts/ingest-wiki.ts
 *
 * Requires NEXT_PUBLIC_CONVEX_URL env var (reads from .env.local).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";

// Load .env.local if present (local dev); on Vercel, env vars are injected automatically
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set in .env.local");
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);
const OBSIDIAN_DIR = path.join(__dirname, "..", "..", "obsidian");

const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);
const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

interface FileEntry {
  filePath: string;
  slug: string;
}

function getAllMarkdownFiles(dir: string = OBSIDIAN_DIR, basePath: string = ""): FileEntry[] {
  const files: FileEntry[] = [];
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
      files.push({ filePath: fullPath, slug: slug.replace(/\.md$/, "") });
    }
  }
  return files;
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function main() {
  const files = getAllMarkdownFiles();
  console.log(`Found ${files.length} markdown files`);

  let updated = 0;
  let skipped = 0;
  const slugs: string[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(file.filePath, "utf-8");
    const contentHash = hashContent(raw);
    const { data, content } = matter(raw);

    const h1Match = content.match(/^#\s+(.+)$/m);
    const title = (data.title as string) || h1Match?.[1] || file.slug.split("/").pop() || file.slug;
    const body = h1Match ? content.replace(/^#\s+.+$/m, "").replace(/^\n+/, "") : content;
    const tags = Array.isArray(data.tags) ? (data.tags as string[]) : [];

    const result = await client.mutation(api.documents.upsert, {
      slug: file.slug,
      title,
      content: body,
      tags,
      contentHash,
    });

    slugs.push(file.slug);
    if (result.skipped) {
      skipped++;
    } else {
      updated++;
    }

    const total = updated + skipped;
    if (total % 50 === 0) {
      console.log(`  Processed ${total}/${files.length} (${updated} updated, ${skipped} skipped)...`);
    }
  }

  // Remove documents that no longer exist on disk
  const removeResult = await client.mutation(api.documents.removeStale, { activeSlugs: slugs });
  console.log(`Done! ${updated} updated, ${skipped} unchanged, ${removeResult.removed} removed.`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
