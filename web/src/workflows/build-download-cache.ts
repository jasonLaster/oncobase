/**
 * Durable workflow for building and caching the wiki download zips.
 *
 * Triggered as a child of postDeployWorkflow so the first real user request
 * always hits the fast path (307 → CDN). Falls back to retry on failure —
 * unlike after(), a failed workflow retries automatically.
 *
 * Usage:
 *   import { start } from "workflow/api";
 *   import { buildDownloadCacheWorkflow } from "@/workflows/build-download-cache";
 *   await start(buildDownloadCacheWorkflow, [type]);
 */

import { FatalError, RetryableError } from "workflow";

export type DownloadType = "full" | "markdown";

// ─── steps (full Node.js access) ─────────────────────────────────────────────

async function checkPdfAssets(): Promise<number> {
  "use step";
  const { fetchQuery } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");
  const assets = await fetchQuery(api.documents.listPdfAssets, {});
  console.log(`[download-cache] PDF assets in Convex: ${assets.length}`);
  return assets.length;
}

async function buildAndUpload(type: DownloadType): Promise<string> {
  "use step";
  const fs = await import("fs");
  const path = await import("path");
  const archiver = (await import("archiver")).default;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new FatalError("BLOB_READ_WRITE_TOKEN not set");

  const OBSIDIAN_DIR = process.env.OBSIDIAN_DIR ?? path.join(process.cwd(), "..", "obsidian");
  const diskAvailable = !process.env.VERCEL && fs.existsSync(OBSIDIAN_DIR);

  console.log(`[download-cache] Building ${type} archive (disk=${diskAvailable})`);
  const t0 = Date.now();

  const BLOB_NAMES = {
    full: "diana-tnbc-wiki-full.zip",
    markdown: "diana-tnbc-wiki-markdown.zip",
  } as const;

  const PART_SIZE = 10 * 1024 * 1024;

  // ── build stream ────────────────────────────────────────────────────────────
  const zipStream = await new Promise<ReadableStream<Uint8Array>>((resolve) => {
    resolve(new ReadableStream<Uint8Array>({
      start(controller) {
        const arc = archiver("zip", { zlib: { level: 1 } });
        arc.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        arc.on("end", () => controller.close());
        arc.on("error", (err: Error) => controller.error(err));

        (async () => {
          if (diskAvailable) {
            const { addDirToDiskArchive } = await import("@/lib/archive-helpers");
            addDirToDiskArchive(arc, OBSIDIAN_DIR);
          } else if (type === "full") {
            await fillFullArchive(arc, token);
          } else {
            await fillMarkdownArchive(arc);
          }
          arc.finalize();
        })().catch((err: Error) => controller.error(err));
      },
    }));
  });

  // ── multipart upload ────────────────────────────────────────────────────────
  const { createMultipartUploader } = await import("@vercel/blob");
  const uploader = await createMultipartUploader(BLOB_NAMES[type], {
    access: "public",
    token,
    allowOverwrite: true,
  });

  const reader = zipStream.getReader();
  const parts: Array<{ etag: string; partNumber: number }> = [];
  let partNumber = 1;
  let chunks: Buffer[] = [];
  let size = 0;
  let totalBytes = 0;

  const flush = async () => {
    if (size === 0) return;
    const body = Buffer.concat(chunks);
    console.log(`[download-cache] Uploading part ${partNumber} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    try {
      const part = await uploader.uploadPart(partNumber++, body);
      parts.push(part);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new RetryableError(`Part upload failed: ${msg}`);
    }
    totalBytes += size;
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
  console.log(`[download-cache] Upload complete: ${(totalBytes / 1024 / 1024).toFixed(1)} MB in ${Date.now() - t0}ms → ${result.url}`);
  return result.url;
}

async function saveCache(type: DownloadType, url: string): Promise<void> {
  "use step";
  const { fetchMutation } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");

  const CACHE_KEYS = {
    full: "wiki-zip-cache",
    markdown: "wiki-zip-cache-markdown",
  } as const;

  const info = {
    url,
    builtAt: Date.now(),
    deployId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  };

  await fetchMutation(api.documents.setMeta, {
    key: CACHE_KEYS[type],
    value: JSON.stringify(info),
  });
  console.log(`[download-cache] Cache entry saved for type=${type} deployId=${info.deployId}`);
}

// ─── archive fill helpers (called inside step, full Node.js access) ───────────

async function fillFullArchive(arc: import("archiver").Archiver, token: string) {
  const { fetchQuery } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");
  const { get } = await import("@vercel/blob");

  const pdfAssets = await fetchQuery(api.documents.listPdfAssets, {});
  console.log(`[download-cache] Fetching ${pdfAssets.length} PDFs from Blob`);

  const BATCH = 20;
  for (let i = 0; i < pdfAssets.length; i += BATCH) {
    const batch = pdfAssets.slice(i, i + BATCH);
    const t0 = Date.now();
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
        } catch (err: unknown) {
          console.warn(`[download-cache] Failed to fetch PDF ${asset.path}:`, err);
          return null;
        }
      })
    );
    const fetched = buffers.filter(Boolean).length;
    console.log(`[download-cache] PDF batch ${i / BATCH + 1}: ${fetched}/${batch.length} fetched in ${Date.now() - t0}ms`);
    for (const item of buffers) {
      if (item) arc.append(item.buf, { name: item.name });
    }
  }

  await fillMarkdownArchive(arc);
}

async function fillMarkdownArchive(arc: import("archiver").Archiver) {
  const { fetchQuery } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");

  type ListPageResult = { page: Array<{ slug: string; content: string }>; isDone: boolean; continueCursor: string };
  let cursor: string | null = null;
  let isDone = false;
  let pageNum = 0;
  let totalDocs = 0;

  while (!isDone) {
    const page = (await fetchQuery(api.documents.listPageWithContent, { cursor, numItems: 50 })) as ListPageResult;
    for (const doc of page.page) {
      if (doc.content) {
        arc.append(Buffer.from(doc.content, "utf-8"), { name: `${doc.slug}.md` });
        totalDocs++;
      }
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
    console.log(`[download-cache] Markdown page ${++pageNum}: ${page.page.length} docs (total=${totalDocs}, done=${isDone})`);
  }
}

// ─── workflow orchestrator ────────────────────────────────────────────────────

export async function buildDownloadCacheWorkflow(type: DownloadType) {
  "use workflow";

  console.log(`[download-cache] Workflow started: type=${type} deploy=${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`);

  // For the full archive, bail early if PDFs haven't been ingested yet
  if (type === "full") {
    const pdfCount = await checkPdfAssets();
    if (pdfCount === 0) {
      console.log("[download-cache] No PDFs ingested yet — skipping full cache build");
      return;
    }
  }

  const url = await buildAndUpload(type);
  await saveCache(type, url);

  console.log(`[download-cache] Workflow complete: type=${type}`);
}
