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
import { applyPiiRedactions } from "../src/lib/pii-redaction";

// Load .env.local if present (local dev); on Vercel, env vars are injected automatically
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set — skipping ingestion");
  process.exit(0);
}

const client = new ConvexHttpClient(CONVEX_URL);
const OBSIDIAN_DIR = path.join(__dirname, "..", "..", "obsidian");
const PREVIEW_SEED_SLUGS = new Set([
  "index",
  "wiki/diagnostics/diagnosis",
  "wiki/prognosis/survival-statistics",
  "wiki/treatment/keynote-522",
]);

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

interface ExistingHashPage {
  page: Array<{ slug: string; contentHash: string | undefined }>;
  isDone: boolean;
  continueCursor: string;
}

function isPreviewDeployment() {
  return process.env.VERCEL_ENV === "preview";
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

function isMissingFunctionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Could not find public function");
}

function prepareUpsertArgs(file: FileEntry) {
  const raw = fs.readFileSync(file.filePath, "utf-8");
  let data: Record<string, unknown> = {};
  let content = raw;
  try {
    ({ data, content } = matter(raw));
  } catch {
    console.warn(`  ⚠ YAML parse error in ${file.slug} — ingesting without frontmatter`);
  }
  const sanitizedContent = applyPiiRedactions(content);
  const contentHash = hashContent(sanitizedContent);
  const h1Match = sanitizedContent.match(/^#\s+(.+)$/m);
  const title = (data.title as string) || h1Match?.[1] || file.slug.split("/").pop() || file.slug;
  const body = h1Match
    ? sanitizedContent.replace(/^#\s+.+$/m, "").replace(/^\n+/, "")
    : sanitizedContent;
  const tags = Array.isArray(data.tags) ? (data.tags as string[]) : [];
  const MAX_CONTENT = 900_000;
  const truncatedBody = body.length > MAX_CONTENT
    ? body.slice(0, MAX_CONTENT) + "\n\n[Content truncated — full document is " + Math.round(body.length / 1024) + "KB]"
    : body;
  return { slug: file.slug, title, content: truncatedBody, tags, contentHash };
}

async function loadExistingContentHashes(): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const page = (await client.query(api.documents.embeddingStatusPage, {
      cursor,
      numItems: 200,
    })) as ExistingHashPage;

    for (const doc of page.page) {
      if (doc.contentHash) hashes.set(doc.slug, doc.contentHash);
    }

    isDone = page.isDone;
    cursor = page.continueCursor;
  }

  return hashes;
}

async function main() {
  const t0 = Date.now();

  try {
    await client.query(api.documents.listPageDescriptions, { cursor: null, numItems: 1 });
  } catch (error) {
    if (isMissingFunctionError(error)) {
      console.warn("Convex document functions are not available in this deployment — skipping wiki ingest.");
      return;
    }
    throw error;
  }

  const allFiles = getAllMarkdownFiles();
  const files = isPreviewDeployment()
    ? allFiles.filter((file) => PREVIEW_SEED_SLUGS.has(file.slug))
    : allFiles;
  if (isPreviewDeployment()) {
    console.log(
      `Found ${allFiles.length} markdown files; preview ingesting ${files.length} seed documents`
    );
  } else {
    console.log(`Found ${files.length} markdown files`);
  }
  const existingHashes = await loadExistingContentHashes();
  console.log(`Loaded ${existingHashes.size} existing document hashes`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const slugs: string[] = [];

  // Run mutations in parallel batches to avoid serial latency across 2000+ files
  const CONCURRENCY = 10;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (file) => {
        const args = prepareUpsertArgs(file);
        if (existingHashes.get(args.slug) === args.contentHash) {
          return { slug: file.slug, result: { skipped: true } };
        }

        try {
          const result = await client.mutation(api.documents.upsert, args);
          return { slug: file.slug, result };
        } catch (err) {
          const msg = (err as Error).message || String(err);
          console.error(`  ✗ Failed to upsert ${file.slug} (${Math.round(args.content.length / 1024)}KB): ${msg.slice(0, 200)}`);
          return { slug: file.slug, result: null };
        }
      })
    );

    for (const { slug, result } of results) {
      if (!result) { failed++; continue; }
      slugs.push(slug);
      if (result.skipped) skipped++;
      else updated++;
    }

    const done = Math.min(i + CONCURRENCY, files.length);
    if (done % 100 === 0 || done === files.length) {
      console.log(`  Processed ${done}/${files.length} — ${updated} updated, ${skipped} skipped, ${failed} failed (${Date.now() - t0}ms)`);
    }
  }

  console.log(`Done in ${Date.now() - t0}ms — ${updated} updated, ${skipped} unchanged, ${failed} failed.`);

  // Store download info sizes in Convex meta so the UI can display them
  const downloadInfoPath = path.join(__dirname, "..", "public", "wiki-download-info.json");
  if (fs.existsSync(downloadInfoPath)) {
    try {
      const info = JSON.parse(fs.readFileSync(downloadInfoPath, "utf-8"));
      await client.mutation(api.documents.setMeta, {
        key: "wiki-download-info",
        value: JSON.stringify(info),
      });
      console.log("Stored wiki download info in Convex meta.");
    } catch (err) {
      console.error("Failed to store wiki download info:", (err as Error).message);
    }
  }
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
