/**
 * Upload PDFs from obsidian/ to Vercel Blob (public store), recording each in Convex pdfAssets.
 * Skips PDFs already present in Convex — fully incremental.
 *
 * Usage: bun scripts/ingest-pdfs.ts [--force]
 *   --force  Re-upload all PDFs even if already in Convex (use after switching blob stores)
 *
 * Requires:
 *   NEXT_PUBLIC_CONVEX_URL        — Convex deployment URL
 *   PUBLIC_BLOB_READ_WRITE_TOKEN  — Vercel Blob write token for the public store
 */
import fs from "fs";
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set — skipping PDF ingest");
  process.exit(0);
}

const BLOB_TOKEN = process.env.PUBLIC_BLOB_READ_WRITE_TOKEN;
if (!BLOB_TOKEN) {
  console.error("PUBLIC_BLOB_READ_WRITE_TOKEN not set — skipping PDF ingest");
  process.exit(0);
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

function* findPdfs(dir: string, basePath = ""): Generator<{ fullPath: string; relativePath: string }> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* findPdfs(fullPath, relativePath);
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      yield { fullPath, relativePath };
    }
  }
}

function isMissingFunctionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Could not find public function");
}

async function main() {
  const { put } = await import("@vercel/blob");
  const force = process.argv.includes("--force");

  // Fetch existing PDF assets to determine what's already uploaded
  let existing: Array<{ path: string }> = [];
  try {
    existing = await client.query(api.documents.listPdfAssets, {});
  } catch (error) {
    if (isMissingFunctionError(error)) {
      console.warn("Convex PDF asset functions are not available in this deployment — skipping PDF ingest.");
      return;
    }
    throw error;
  }
  const existingPaths = new Set(existing.map((a) => a.path));
  console.log(`${existing.length} PDFs already in Blob.`);

  const pdfs = [...findPdfs(OBSIDIAN_DIR)];
  const toUpload = force ? pdfs : pdfs.filter((p) => !existingPaths.has(p.relativePath));
  console.log(`Found ${pdfs.length} PDFs total, ${toUpload.length} to upload${force ? " (--force)" : " (new only)"}.`);

  let uploaded = 0;
  for (const { fullPath, relativePath } of toUpload) {
    const buffer = fs.readFileSync(fullPath);
    try {
      const blob = await put(`pdfs/${relativePath}`, buffer, {
        access: "public",
        token: BLOB_TOKEN,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      await client.mutation(api.documents.upsertPdfAsset, {
        path: relativePath,
        blobUrl: blob.url,
        sizeBytes: buffer.length,
      });
      uploaded++;
      if (uploaded % 10 === 0) {
        console.log(`  Uploaded ${uploaded}/${toUpload.length}…`);
      }
    } catch (err) {
      console.error(`  ✗ Failed to upload ${relativePath}: ${(err as Error).message}`);
    }
  }

  console.log(`Done! ${uploaded} PDFs uploaded, ${existing.length} already present.`);
}

main().catch((err) => {
  console.error("PDF ingest failed:", err);
  process.exit(1);
});
