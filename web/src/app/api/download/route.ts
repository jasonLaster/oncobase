import { NextRequest, NextResponse, after } from "next/server";
import path from "path";
import fs from "fs";
import archiver from "archiver";
import { Readable } from "stream";

export const maxDuration = 300;

const OBSIDIAN_DIR =
  process.env.OBSIDIAN_DIR ?? path.join(process.cwd(), "..", "obsidian");

const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);
const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

// ─── filesystem helpers ───────────────────────────────────────────────────────

function addDirToArchive(arc: archiver.Archiver, dir: string, basePath: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const zipPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirToArchive(arc, fullPath, zipPath);
    } else {
      arc.file(fullPath, { name: zipPath });
    }
  }
}

/**
 * Creates a fresh, unlocked Web ReadableStream for the zip.
 * Using the ReadableStream constructor (rather than Readable.toWeb) keeps the
 * stream unlocked until the consumer calls getReader() / pipeTo(), which is
 * required when passing it as a fetch / put() body.
 */
function buildZipStreamFromDisk(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const arc = archiver("zip", { zlib: { level: 1 } });
      arc.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      arc.on("end", () => controller.close());
      arc.on("error", (err) => controller.error(err));
      addDirToArchive(arc, OBSIDIAN_DIR, "");
      arc.finalize();
    },
  });
}

// ─── cache helpers ────────────────────────────────────────────────────────────

const ZIP_CACHE_KEY = "wiki-zip-cache";

interface ZipCacheInfo {
  url: string;
  builtAt: number;
  deployId: string | null;
}

async function getCachedZipInfo(): Promise<ZipCacheInfo | null> {
  try {
    const { fetchQuery } = await import("convex/nextjs");
    const { api } = await import("../../../../convex/_generated/api");
    const raw = await fetchQuery(api.documents.getMeta, { key: ZIP_CACHE_KEY });
    return raw ? (JSON.parse(raw) as ZipCacheInfo) : null;
  } catch {
    return null;
  }
}

async function setCachedZipInfo(info: ZipCacheInfo) {
  try {
    const { fetchMutation } = await import("convex/nextjs");
    const { api } = await import("../../../../convex/_generated/api");
    await fetchMutation(api.documents.setMeta, {
      key: ZIP_CACHE_KEY,
      value: JSON.stringify(info),
    });
  } catch (err) {
    console.error("[download] Failed to update zip cache:", err);
  }
}

function isCacheFresh(info: ZipCacheInfo): boolean {
  // Private-access blobs can't be served via redirect — treat as stale
  if (info.url.includes(".private.blob.")) return false;
  // In Vercel deployments, stale once the deployment changes
  const deployId = process.env.VERCEL_DEPLOYMENT_ID ?? null;
  if (deployId && info.deployId !== deployId) return false;
  // Fallback: 24-hour TTL (covers local dev and preview environments)
  return Date.now() - info.builtAt < 24 * 60 * 60 * 1000;
}

// ─── background cache builder ─────────────────────────────────────────────────

const PART_SIZE = 10 * 1024 * 1024; // 10 MB — well above the 5 MB minimum

async function uploadStreamViaMultipart(
  stream: ReadableStream<Uint8Array>,
  token: string
): Promise<string> {
  const { createMultipartUploader } = await import("@vercel/blob");

  const uploader = await createMultipartUploader("diana-tnbc-wiki-full.zip", {
    access: "public",
    token,
    allowOverwrite: true,
  });

  const reader = stream.getReader();
  const parts: Array<{ etag: string; partNumber: number }> = [];
  let partNumber = 1;
  let chunks: Buffer[] = [];
  let size = 0;

  const flush = async () => {
    if (size === 0) return;
    const body = Buffer.concat(chunks);
    const part = await uploader.uploadPart(partNumber++, body);
    parts.push(part);
    chunks = [];
    size = 0;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      chunks.push(Buffer.from(value));
      size += value.byteLength;
    }
    if (size >= PART_SIZE) await flush();
    if (done) { await flush(); break; }
  }

  const result = await uploader.complete(parts);
  return result.url;
}

async function buildAndCacheToBlob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;

  const diskAvailable = !process.env.VERCEL && fs.existsSync(OBSIDIAN_DIR);
  if (!diskAvailable) {
    // Production path requires PDFs in Blob + markdown in Convex.
    // Skip caching until ingest-pdfs.ts has run and pdfAssets are populated.
    const { fetchQuery } = await import("convex/nextjs");
    const { api } = await import("../../../../convex/_generated/api");
    const assets = await fetchQuery(api.documents.listPdfAssets, {});
    if (assets.length === 0) return;
  }

  try {
    const zipStream = diskAvailable
      ? buildZipStreamFromDisk()
      : Readable.toWeb(await buildArchiveFromBlob(token)) as ReadableStream<Uint8Array>;

    const url = await uploadStreamViaMultipart(zipStream, token);

    await setCachedZipInfo({
      url,
      builtAt: Date.now(),
      deployId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    });
    console.log("[download] Cached zip uploaded to Blob:", url);
  } catch (err) {
    console.error("[download] Background cache build failed:", err);
  }
}

async function buildArchiveFromBlob(token: string): Promise<archiver.Archiver> {
  const { get } = await import("@vercel/blob");
  const { fetchQuery } = await import("convex/nextjs");
  const { api } = await import("../../../../convex/_generated/api");

  const arc = archiver("zip", { zlib: { level: 1 } });

  const pdfAssets = await fetchQuery(api.documents.listPdfAssets, {});
  // Fetch all PDFs as Buffers in parallel batches — streaming refs expire before
  // archiver gets to them, so we materialize the content eagerly.
  const BATCH = 20;
  for (let i = 0; i < pdfAssets.length; i += BATCH) {
    const batch = pdfAssets.slice(i, i + BATCH);
    const buffers = await Promise.all(
      batch.map(async (asset) => {
        try {
          const blobResult = await get(asset.blobUrl, { token, access: "private" });
          if (!blobResult) return null;
          const chunks: Buffer[] = [];
          const reader = blobResult.stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value));
          }
          return { name: asset.path, buf: Buffer.concat(chunks) };
        } catch {
          return null;
        }
      })
    );
    for (const item of buffers) {
      if (item) arc.append(item.buf, { name: item.name });
    }
  }

  type ListPageResult = {
    page: Array<{ slug: string; title: string; tags: string[] }>;
    isDone: boolean;
    continueCursor: string;
  };
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page = (await fetchQuery(api.documents.listPage, {
      cursor,
      numItems: 50,
    })) as ListPageResult;
    for (const doc of page.page) {
      const full = await fetchQuery(api.documents.getBySlug, { slug: doc.slug });
      if (full?.content) {
        arc.append(Buffer.from(full.content, "utf-8"), { name: `${doc.slug}.md` });
      }
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
  }

  arc.finalize();
  return arc;
}

// ─── response builders ────────────────────────────────────────────────────────

function zipResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="diana-tnbc-wiki-full.zip"',
    },
  });
}

function cachedBlobRedirect(url: string): Response {
  // Public blob — redirect directly to CDN, no proxying needed
  return NextResponse.redirect(url);
}

// ─── route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") ?? "full";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://diana-tnbc.com";

  if (type === "markdown") {
    return NextResponse.redirect(new URL("/diana-tnbc-wiki-markdown.zip", base));
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;

  // ── Fast path: redirect to cached public Blob URL ──────────────────────────
  if (token) {
    const cached = await getCachedZipInfo();
    if (cached && isCacheFresh(cached)) {
      return cachedBlobRedirect(cached.url);
    }
  }

  // ── Slow path: stream zip on-demand ─────────────────────────────────────────
  // On Vercel, the repo (including obsidian/) is deployed but PDFs aren't in git.
// Always use the Blob path on Vercel; only use disk in local dev.
const diskAvailable = !process.env.VERCEL && fs.existsSync(OBSIDIAN_DIR);
  const zipStream = diskAvailable
    ? buildZipStreamFromDisk()
    : Readable.toWeb(await buildArchiveFromBlob(token ?? "")) as ReadableStream<Uint8Array>;

  // After this response finishes streaming, rebuild and cache to Blob
  if (token) {
    after(buildAndCacheToBlob);
  }

  return zipResponse(zipStream);
}
