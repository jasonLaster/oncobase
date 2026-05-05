/**
 * Generate AI descriptions for wiki pages that don't have one yet.
 * Saves results to Convex so next build uses the cached descriptions.
 *
 * Run before next build:
 *   bun scripts/generate-descriptions.ts
 *
 * Requires NEXT_PUBLIC_CONVEX_URL and AI_GATEWAY_API_KEY.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { ConvexHttpClient } from "convex/browser";
import { generateText } from "ai";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";
import { isSensitiveFrontmatter } from "../src/lib/sensitive-pages";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set — skipping");
  process.exit(0);
}

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("AI_GATEWAY_API_KEY not set — skipping");
  process.exit(0);
}

const client = new ConvexHttpClient(CONVEX_URL);
const OBSIDIAN_DIR = path.join(__dirname, "..", "..", "obsidian");

const EXCLUDED_DIRS = new Set([
  ".obsidian", ".claude", "Google Drive", "Clippings", "Precision medicine", "node_modules",
]);
const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

interface PageEntry { slug: string; title: string; content: string }

function getAllPages(dir: string = OBSIDIAN_DIR, basePath: string = ""): PageEntry[] {
  const pages: PageEntry[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const slug = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      pages.push(...getAllPages(fullPath, slug));
    } else if (entry.name.endsWith(".md")) {
      const pageSlug = slug.replace(/\.md$/, "");
      const raw = fs.readFileSync(fullPath, "utf-8");
      const { data, content } = matter(raw);
      if (isSensitiveFrontmatter(data as Record<string, unknown>)) continue;
      const h1Match = content.match(/^#\s+(.+)$/m);
      const title = (data.title as string) || h1Match?.[1] || entry.name.replace(/\.md$/, "");
      const body = h1Match ? content.replace(/^#\s+.+$/m, "").replace(/^\n+/, "") : content;
      pages.push({ slug: pageSlug, title, content: body });
    }
  }
  return pages;
}

async function generateDescription(title: string, content: string): Promise<string> {
  const excerpt = content.slice(0, 2000);
  const { text } = await generateText({
    model: "openai/gpt-5.4-mini",
    maxOutputTokens: 80,
    system:
      "You write one-sentence descriptions for wiki pages in a breast cancer research knowledge base. Write a single sentence (max 155 characters) summarizing what the page covers. No quotes, no trailing period required.",
    prompt: `Page title: ${title}\n\nContent:\n${excerpt}`,
  });
  return text.trim();
}

async function main() {
  const pages = getAllPages();
  console.log(`Found ${pages.length} pages`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const page of pages) {
    try {
      const existing = await client.query(api.documents.getDescription, { slug: page.slug });
      if (existing) {
        skipped++;
        continue;
      }

      const description = await generateDescription(page.title, page.content);
      if (!description) { errors++; continue; }

      await client.mutation(api.documents.setDescription, { slug: page.slug, description });
      console.log(`  ✓ ${page.slug}`);
      generated++;
    } catch (err) {
      console.error(`  ✗ ${page.slug}: ${err}`);
      errors++;
    }
  }

  console.log(`\nDone: ${generated} generated, ${skipped} already cached, ${errors} errors`);
}

main().catch(console.error);
