/**
 * Upload PDFs from obsidian/ to Vercel Blob, recording each in Convex pdfAssets.
 * Skips PDFs already present in Convex — fully incremental.
 *
 * Usage: bun scripts/ingest-pdfs.ts
 *
 * Requires:
 *   NEXT_PUBLIC_CONVEX_URL   — Convex deployment URL
 *   BLOB_READ_WRITE_TOKEN    — Vercel Blob write token
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

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!BLOB_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN not set — skipping PDF ingest");
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

async function main() {
  const { put } = await import("@vercel/blob");

  // Fetch existing PDF assets to determine what's already uploaded
  const existing = await client.query(api.documents.listPdfAssets, {});
  const existingPaths = new Set(existing.map((a) => a.path));
  console.log(`${existing.length} PDFs already in Blob.`);

  const pdfs = [...findPdfs(OBSIDIAN_DIR)];
  const toUpload = pdfs.filter((p) => !existingPaths.has(p.relativePath));
  console.log(`Found ${pdfs.length} PDFs total, ${toUpload.length} new.`);

  let uploaded = 0;
  for (const { fullPath, relativePath } of toUpload) {
    const buffer = fs.readFileSync(fullPath);
    try {
      const blob = await put(`pdfs/${relativePath}`, buffer, {
        access: "private",
        token: BLOB_TOKEN,
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
