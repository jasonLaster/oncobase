/**
 * Upload non-PDF, non-markdown assets from obsidian/ to Vercel Blob (public store),
 * recording each in Convex fileAssets. Skips files already present — fully incremental.
 *
 * Handles: images (.jpg, .jpeg, .png, .gif, .webp, .svg), data files (.csv), and
 * any other binary files referenced from markdown pages.
 *
 * Usage: bun scripts/ingest-assets.ts [--force]
 *   --force  Re-upload all assets even if already in Convex
 *
 * Requires:
 *   NEXT_PUBLIC_CONVEX_URL        — Convex deployment URL
 *   PUBLIC_BLOB_READ_WRITE_TOKEN or BLOB_READ_WRITE_TOKEN
 *                             — Vercel Blob write token for the public store
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
  console.error("NEXT_PUBLIC_CONVEX_URL not set — skipping asset ingest");
  process.exit(0);
}

const BLOB_TOKEN =
  process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ??
  process.env.BLOB_READ_WRITE_TOKEN;
if (!BLOB_TOKEN) {
  console.error("Blob write token not set — skipping asset ingest");
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

// Extensions to ingest — everything except markdown and PDFs (PDFs have their own script)
const SUPPORTED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".csv",
]);

function* findAssets(dir: string, basePath = ""): Generator<{ fullPath: string; relativePath: string }> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* findAssets(fullPath, relativePath);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        yield { fullPath, relativePath };
      }
    }
  }
}

async function main() {
  const { put } = await import("@vercel/blob");
  const force = process.argv.includes("--force");

  const existing = await client.query(api.documents.listFileAssets, {});
  const existingPaths = new Set(existing.map((a) => a.path));
  console.log(`${existing.length} assets already in Blob.`);

  const assets = [...findAssets(OBSIDIAN_DIR)];
  const toUpload = force ? assets : assets.filter((a) => !existingPaths.has(a.relativePath));
  console.log(`Found ${assets.length} assets total, ${toUpload.length} to upload${force ? " (--force)" : " (new only)"}.`);

  // Group by extension for logging
  const byExt: Record<string, number> = {};
  for (const { relativePath } of toUpload) {
    const ext = path.extname(relativePath).toLowerCase();
    byExt[ext] = (byExt[ext] ?? 0) + 1;
  }
  for (const [ext, count] of Object.entries(byExt)) {
    console.log(`  ${ext}: ${count} files`);
  }

  let uploaded = 0;
  let failed = 0;
  let skippedLfs = 0;
  for (const { fullPath, relativePath } of toUpload) {
    const buffer = fs.readFileSync(fullPath);
    if (buffer.length < 200 && buffer.toString("utf8", 0, 40).includes("git-lfs")) {
      skippedLfs++;
      console.error(`  ✗ Skipping ${relativePath}: unmaterialized Git LFS pointer (run \`git lfs pull\` first)`);
      continue;
    }
    try {
      const blob = await put(`files/${relativePath}`, buffer, {
        access: "public",
        token: BLOB_TOKEN,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      await client.mutation(api.documents.upsertFileAsset, {
        path: relativePath,
        blobUrl: blob.url,
        sizeBytes: buffer.length,
      });
      uploaded++;
      if (uploaded % 20 === 0) {
        console.log(`  Uploaded ${uploaded}/${toUpload.length}…`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ Failed to upload ${relativePath}: ${(err as Error).message}`);
    }
  }

  console.log(
    `Done! ${uploaded} assets uploaded, ${failed} failed, ${skippedLfs} skipped (LFS pointers), ${existing.length} already present.`,
  );
}

main().catch((err) => {
  console.error("Asset ingest failed:", err);
  process.exit(1);
});
