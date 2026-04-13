import { NextRequest, NextResponse, after } from "next/server";
import path from "path";
import fs from "fs";
import archiver from "archiver";

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
 * Wraps an archiver in a fresh Web ReadableStream so the stream is unlocked
 * until the consumer calls getReader(). Mirrors the pattern used by
 * buildZipStreamFromDisk to avoid Readable.toWeb() timing/backpressure issues.
 */
function archiverToStream(
  fill: (arc: archiver.Archiver) => void
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const arc = archiver("zip", { zlib: { level: 1 } });
      arc.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      arc.on("end", () => controller.close());
      arc.on("error", (err) => controller.error(err));
      // fill() may be sync or async; for async we just let it run
      Promise.resolve(fill(arc)).catch((err) => controller.error(err));
    },
  });
}

function buildZipStreamFromDisk(): ReadableStream<Uint8Array> {
  return archiverToStream((arc) => {
    addDirToArchive(arc, OBSIDIAN_DIR, "");
    arc.finalize();
  });
}

// ─── Convex archive builders ──────────────────────────────────────────────────

async function getConvexApi() {
  const { fetchQuery } = await import("convex/nextjs");
  const { api } = await import("../../../../convex/_generated/api");
  return { fetchQuery, api };
}

/** Full archive: PDFs from Blob + markdown from Convex */
function buildFullArchiveStream(token: string): ReadableStream<Uint8Array> {
  return archiverToStream(async (arc) => {
    const { fetchQuery, api } = await getConvexApi();
    const { get } = await import("@vercel/blob");

    const pdfAssets = await fetchQuery(api.documents.listPdfAssets, {});
    const BATCH = 20;
    for (let i = 0; i < pdfAssets.length; i += BATCH) {
      const batch = pdfAssets.slice(i, i + BATCH);
      const buffers = await Promise.all(
        batch.map(async (asset) => {
          try {
            const blobResult = await get(asset.blobUrl, { token, access: "private" });
            if (!blobResult?.stream) return null;
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

    await appendMarkdownToArchive(arc, fetchQuery, api);
    arc.finalize();
  });
}

/** Markdown-only archive: just markdown from Convex */
function buildMarkdownArchiveStream(): ReadableStream<Uint8Array> {
  return archiverToStream(async (arc) => {
    const { fetchQuery, api } = await getConvexApi();
    await appendMarkdownToArchive(arc, fetchQuery, api);
    arc.finalize();
  });
}

type ListPageWithContentResult = {
  page: Array<{ slug: string; content: string }>;
  isDone: boolean;
  continueCursor: string;
};

async function appendMarkdownToArchive(
  arc: archiver.Archiver,
  fetchQuery: Awaited<ReturnType<typeof getConvexApi>>["fetchQuery"],
  api: Awaited<ReturnType<typeof getConvexApi>>["api"]
) {
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page = (await fetchQuery(api.documents.listPageWithContent, {
      cursor,
      numItems: 50,
    })) as ListPageWithContentResult;
    for (const doc of page.page) {
      if (doc.content) {
        arc.append(Buffer.from(doc.content, "utf-8"), { name: `${doc.slug}.md` });
      }
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
}

// ─── cache helpers ────────────────────────────────────────────────────────────

const CACHE_KEYS = {
  full: "wiki-zip-cache",
  markdown: "wiki-zip-cache-markdown",
} as const;

type DownloadType = keyof typeof CACHE_KEYS;

const BLOB_NAMES = {
  full: "diana-tnbc-wiki-full.zip",
  markdown: "diana-tnbc-wiki-markdown.zip",
} as const;

const CONTENT_DISPOSITIONS = {
  full: 'attachment; filename="diana-tnbc-wiki-full.zip"',
  markdown: 'attachment; filename="diana-tnbc-wiki-markdown.zip"',
} as const;

interface ZipCacheInfo {
  url: string;
  builtAt: number;
  deployId: string | null;
}

async function getCachedZipInfo(type: DownloadType): Promise<ZipCacheInfo | null> {
  try {
    const { fetchQuery, api } = await getConvexApi();
    const raw = await fetchQuery(api.documents.getMeta, { key: CACHE_KEYS[type] });
    return raw ? (JSON.parse(raw) as ZipCacheInfo) : null;
  } catch {
    return null;
  }
}

async function setCachedZipInfo(type: DownloadType, info: ZipCacheInfo) {
  try {
    const { fetchMutation } = await import("convex/nextjs");
    const { api } = await import("../../../../convex/_generated/api");
    await fetchMutation(api.documents.setMeta, {
      key: CACHE_KEYS[type],
      value: JSON.stringify(info),
    });
  } catch (err) {
    console.error(`[download] Failed to update ${type} zip cache:`, err);
  }
}

function isCacheFresh(info: ZipCacheInfo): boolean {
  if (info.url.includes(".private.blob.")) return false;
  const deployId = process.env.VERCEL_DEPLOYMENT_ID ?? null;
  if (deployId && info.deployId !== deployId) return false;
  return Date.now() - info.builtAt < 24 * 60 * 60 * 1000;
}

// ─── background cache builder ─────────────────────────────────────────────────

const PART_SIZE = 10 * 1024 * 1024;

async function uploadStreamViaMultipart(
  stream: ReadableStream<Uint8Array>,
  blobName: string,
  token: string
): Promise<string> {
  const { createMultipartUploader } = await import("@vercel/blob");

  const uploader = await createMultipartUploader(blobName, {
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

async function buildAndCacheToBlob(type: DownloadType, token: string) {
  const diskAvailable = !process.env.VERCEL && fs.existsSync(OBSIDIAN_DIR);

  if (type === "full" && !diskAvailable) {
    const { fetchQuery, api } = await getConvexApi();
    const assets = await fetchQuery(api.documents.listPdfAssets, {});
    if (assets.length === 0) {
      console.log("[download] Skipping full cache — no PDF assets ingested yet");
      return;
    }
  }

  try {
    let zipStream: ReadableStream<Uint8Array>;
    if (type === "full") {
      zipStream = diskAvailable ? buildZipStreamFromDisk() : buildFullArchiveStream(token);
    } else {
      zipStream = diskAvailable
        ? buildZipStreamFromDisk() // local dev: full disk zip (markdown included)
        : buildMarkdownArchiveStream();
    }

    const url = await uploadStreamViaMultipart(zipStream, BLOB_NAMES[type], token);
    await setCachedZipInfo(type, {
      url,
      builtAt: Date.now(),
      deployId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    });
    console.log(`[download] Cached ${type} zip uploaded to Blob:`, url);
  } catch (err) {
    console.error(`[download] Background ${type} cache build failed:`, err);
  }
}

// ─── response builders ────────────────────────────────────────────────────────

function zipResponse(stream: ReadableStream<Uint8Array>, type: DownloadType): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": CONTENT_DISPOSITIONS[type],
    },
  });
}

function cachedBlobRedirect(url: string): Response {
  return NextResponse.redirect(url);
}

// ─── route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const rawType = request.nextUrl.searchParams.get("type") ?? "full";
  const type: DownloadType = rawType === "markdown" ? "markdown" : "full";

  const token = process.env.BLOB_READ_WRITE_TOKEN;

  // ── Fast path: redirect to cached public Blob URL ──────────────────────────
  if (token) {
    const cached = await getCachedZipInfo(type);
    if (cached && isCacheFresh(cached)) {
      return cachedBlobRedirect(cached.url);
    }
  }

  // ── Slow path: stream zip on-demand ────────────────────────────────────────
  const diskAvailable = !process.env.VERCEL && fs.existsSync(OBSIDIAN_DIR);

  let zipStream: ReadableStream<Uint8Array>;
  if (diskAvailable) {
    zipStream = buildZipStreamFromDisk();
  } else if (!token) {
    return new NextResponse("Download unavailable: storage not configured", { status: 503 });
  } else if (type === "markdown") {
    zipStream = buildMarkdownArchiveStream();
  } else {
    zipStream = buildFullArchiveStream(token);
  }

  // After streaming, rebuild and cache to Blob in the background
  if (token) {
    after(() => buildAndCacheToBlob(type, token));
  }

  return zipResponse(zipStream, type);
}
