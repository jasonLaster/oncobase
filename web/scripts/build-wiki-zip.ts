/**
 * Build-time script to generate two wiki zip archives:
 *   - diana-tnbc-wiki-full.zip     — all files (md, pdf, images, etc.)
 *   - diana-tnbc-wiki-markdown.zip — .md files only
 *
 * The markdown zip is written to public/ and served as a static asset.
 * The full zip (may exceed Vercel's 1 GiB static file limit) is uploaded to
 * Vercel Blob when PUBLIC_BLOB_READ_WRITE_TOKEN is set, otherwise written to public/.
 *
 * Also writes public/wiki-download-info.json with sizes and URLs for both
 * archives so the UI and ingest script can display / store them.
 *
 * Usage: bun scripts/build-wiki-zip.ts
 */
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import matter from "gray-matter";
import { isSensitiveFrontmatter } from "../src/lib/sensitive-pages";

const OBSIDIAN_DIR = path.join(__dirname, "..", "..", "obsidian");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);

const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

function isSensitiveMarkdownFile(filePath: string) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data } = matter(raw);
    return isSensitiveFrontmatter(data as Record<string, unknown>);
  } catch {
    return false;
  }
}

function isSensitiveSidecarFile(filePath: string) {
  const ext = path.extname(filePath);
  if (!ext || ext === ".md") return false;
  const siblingMarkdownPath = filePath.slice(0, -ext.length) + ".md";
  return fs.existsSync(siblingMarkdownPath) && isSensitiveMarkdownFile(siblingMarkdownPath);
}

function addFilesToZip(
  zip: JSZip,
  dir: string,
  basePath: string,
  filter?: (name: string) => boolean
) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const zipPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      addFilesToZip(zip, fullPath, zipPath, filter);
    } else {
      if (
        (entry.name.endsWith(".md") && isSensitiveMarkdownFile(fullPath)) ||
        isSensitiveSidecarFile(fullPath)
      ) {
        continue;
      }
      if (filter && !filter(entry.name)) continue;
      zip.file(zipPath, fs.readFileSync(fullPath));
    }
  }
}

async function buildZip(filter?: (name: string) => boolean): Promise<Buffer> {
  const zip = new JSZip();
  addFilesToZip(zip, OBSIDIAN_DIR, "", filter);
  const fileCount = Object.keys(zip.files).filter((f) => !zip.files[f].dir).length;
  console.log(`  Zipping ${fileCount} files…`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function uploadToBlob(buffer: Buffer, filename: string): Promise<string | null> {
  const token =
    process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.log(`  No Blob write token — skipping Blob upload for ${filename}`);
    return null;
  }

  try {
    const { put } = await import("@vercel/blob");
    console.log(`  Uploading ${filename} to Vercel Blob…`);
    const blob = await put(filename, buffer, {
      access: "public",
      token,
      allowOverwrite: true,
    });
    console.log(`  → Blob URL: ${blob.url}`);
    return blob.url;
  } catch (err) {
    console.error(`  Blob upload failed: ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  const mdPath = path.join(PUBLIC_DIR, "diana-tnbc-wiki-markdown.zip");
  const infoPath = path.join(PUBLIC_DIR, "wiki-download-info.json");

  // Remove any stale local copy of the full zip (it must come from Vercel Blob)
  const staleFullPath = path.join(PUBLIC_DIR, "diana-tnbc-wiki-full.zip");
  if (fs.existsSync(staleFullPath)) {
    fs.unlinkSync(staleFullPath);
    console.log("  Removed stale local full zip from public/");
  }

  // Check if existing info already has a blob URL for the full zip
  let existingFullUrl: string | null = null;
  if (fs.existsSync(infoPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
      existingFullUrl = existing.full?.url ?? null;
    } catch { /* ignore */ }
  }

  // Skip rebuild if markdown zip and info already exist and we have a full URL
  if (fs.existsSync(mdPath) && fs.existsSync(infoPath) && existingFullUrl) {
    console.log("Wiki zips already exist — skipping rebuild.");
    return;
  }

  console.log("Building full wiki zip (markdown + PDFs)…");
  const fullBuffer = await buildZip();
  console.log(`  Full zip: ${(fullBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Try to upload full zip to Vercel Blob (avoids Vercel's 1 GiB static file limit)
  const fullBlobUrl = await uploadToBlob(fullBuffer, "diana-tnbc-wiki-full.zip");

  if (!fullBlobUrl) {
    // No Blob token — cannot serve full zip from Vercel (exceeds 1 GiB static limit).
    // Download will be unavailable until PUBLIC_BLOB_READ_WRITE_TOKEN is configured.
    console.warn("  ⚠ Full wiki zip not uploaded (no Blob write token). Full download will be unavailable.");
  }

  console.log("Building markdown-only zip…");
  const mdBuffer = await buildZip((name) => name.endsWith(".md"));
  fs.writeFileSync(mdPath, mdBuffer);
  console.log(`  → ${mdPath} (${(mdBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

  const info = {
    full: {
      sizeBytes: fullBuffer.length,
      filename: "diana-tnbc-wiki-full.zip",
      url: fullBlobUrl ?? null,
    },
    markdown: {
      sizeBytes: mdBuffer.length,
      filename: "diana-tnbc-wiki-markdown.zip",
      url: null as null, // served as static file
    },
  };
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
  console.log("Wrote public/wiki-download-info.json");
}

main().catch((err) => {
  console.error("Zip generation failed:", err);
  process.exit(1);
});
