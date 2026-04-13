/**
 * Durable workflow for building and caching the wiki download zips.
 *
 * Triggered post-deploy via /api/warm-cache so the first real user request
 * always hits the fast path (307 → CDN). Falls back to retry on failure —
 * unlike after(), a failed workflow retries automatically.
 *
 * Architecture: best of both worlds
 *   - /api/download slow path: archiver streaming (RAM-safe, streams to client)
 *   - This workflow: StatefulZipBuilder (per-file compression cache so unchanged
 *     PDFs are never recompressed — only markdown changes rebuild their entries)
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
  console.log(`[warm-cache] PDF assets in Convex: ${assets.length}`);
  return assets.length;
}

async function buildAndUpload(type: DownloadType): Promise<string> {
  "use step";
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new FatalError("BLOB_READ_WRITE_TOKEN not set");

  const { StatefulZipBuilder, getConvexHelpers } = await import("@/lib/stateful-zip-builder");
  const crypto = await import("crypto");
  const builder = new StatefulZipBuilder();
  const convex = await getConvexHelpers();

  const t0 = Date.now();
  console.log(`[warm-cache] Building ${type} archive with StatefulZipBuilder`);

  // ── PDFs (full archive only) ──────────────────────────────────────────────
  if (type === "full") {
    const { fetchQuery } = await import("convex/nextjs");
    const { api } = await import("../../convex/_generated/api");
    const { get } = await import("@vercel/blob");

    const pdfAssets = await fetchQuery(api.documents.listPdfAssets, {});
    console.log(`[warm-cache] Fetching ${pdfAssets.length} PDFs from Blob (cache-aware)`);

    const BATCH = 20;
    let pdfHits = 0;
    let pdfMisses = 0;
    let pdfFailed = 0;

    for (let i = 0; i < pdfAssets.length; i += BATCH) {
      const batch = pdfAssets.slice(i, i + BATCH);
      const tBatch = Date.now();

      const results = await Promise.all(
        batch.map(async (asset) => {
          try {
            const blobResult = await get(asset.blobUrl, { token, access: "private" });
            if (!blobResult?.stream) {
              console.warn(`[warm-cache] No stream for PDF: ${asset.path}`);
              return null;
            }
            const chunks: Buffer[] = [];
            const reader = blobResult.stream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(Buffer.from(value));
            }
            const content = Buffer.concat(chunks);
            // Use the blob URL path segment as the stable content hash for PDFs.
            // A new upload produces a new URL, so this key changes exactly when
            // the file changes — perfect for cache invalidation.
            const urlHash = new URL(asset.blobUrl).pathname.split("/").pop() ?? asset.blobUrl;
            return { name: asset.path, content, hash: urlHash };
          } catch (err) {
            console.warn(`[warm-cache] Failed to fetch PDF ${asset.path}:`, err);
            return null;
          }
        })
      );

      for (const item of results) {
        if (!item) { pdfFailed++; continue; }
        const status = await builder.addFile(item.name, item.content, item.hash, convex, token);
        if (status === "hit") pdfHits++;
        else pdfMisses++;
      }

      console.log(
        `[warm-cache] PDF batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(pdfAssets.length / BATCH)}: ` +
        `${results.filter(Boolean).length}/${batch.length} fetched in ${Date.now() - tBatch}ms`
      );
    }

    console.log(
      `[warm-cache] PDFs complete: ${pdfHits} cache hits, ${pdfMisses} misses, ${pdfFailed} failed`
    );
  }

  // ── Markdown (both archive types) ─────────────────────────────────────────
  {
    const { fetchQuery } = await import("convex/nextjs");
    const { api } = await import("../../convex/_generated/api");

    type ListPageResult = {
      page: Array<{ slug: string; content: string }>;
      isDone: boolean;
      continueCursor: string;
    };

    let cursor: string | null = null;
    let isDone = false;
    let pageNum = 0;
    let totalDocs = 0;
    let mdHits = 0;
    let mdMisses = 0;

    while (!isDone) {
      const page = (await fetchQuery(api.documents.listPageWithContent, {
        cursor,
        numItems: 50,
      })) as ListPageResult;

      for (const doc of page.page) {
        if (!doc.content) continue;
        const content = Buffer.from(doc.content, "utf-8");
        // Hash the markdown content so unchanged files reuse cached compressed bytes
        const contentHash = crypto.createHash("sha256").update(content).digest("hex");
        const status = await builder.addFile(`${doc.slug}.md`, content, contentHash, convex, token);
        if (status === "hit") mdHits++;
        else mdMisses++;
        totalDocs++;
      }

      isDone = page.isDone;
      cursor = page.continueCursor;
      console.log(
        `[warm-cache] Markdown page ${++pageNum}: ${page.page.length} docs ` +
        `(total=${totalDocs}, done=${isDone})`
      );
    }

    console.log(
      `[warm-cache] Markdown complete: ${mdHits} cache hits, ${mdMisses} misses, ${totalDocs} total`
    );
  }

  // ── Finalize & log stats ──────────────────────────────────────────────────
  const { zip, stats } = builder.finalize();
  console.log(
    `[warm-cache] ZIP finalized: ` +
    `files=${stats.totalFiles} hits=${stats.cacheHits} misses=${stats.cacheMisses} ` +
    `uncompressed=${(stats.totalBytes / 1024 / 1024).toFixed(1)}MB ` +
    `compressed=${(stats.compressedBytes / 1024 / 1024).toFixed(1)}MB ` +
    `ratio=${stats.totalBytes > 0 ? ((1 - stats.compressedBytes / stats.totalBytes) * 100).toFixed(1) : 0}% ` +
    `elapsed=${stats.elapsedMs}ms`
  );

  // ── Multipart upload ──────────────────────────────────────────────────────
  const BLOB_NAMES = {
    full: "diana-tnbc-wiki-full.zip",
    markdown: "diana-tnbc-wiki-markdown.zip",
  } as const;

  const { createMultipartUploader } = await import("@vercel/blob");
  const uploader = await createMultipartUploader(BLOB_NAMES[type], {
    access: "public",
    token,
    allowOverwrite: true,
  });

  const PART_SIZE = 10 * 1024 * 1024; // 10 MB
  const parts: Array<{ etag: string; partNumber: number }> = [];
  let partNumber = 1;

  for (let offset = 0; offset < zip.length; offset += PART_SIZE) {
    const part = zip.subarray(offset, Math.min(offset + PART_SIZE, zip.length));
    console.log(`[warm-cache] Uploading part ${partNumber} (${(part.length / 1024 / 1024).toFixed(1)} MB)`);
    try {
      parts.push(await uploader.uploadPart(partNumber++, part));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new RetryableError(`Part upload failed: ${msg}`);
    }
  }

  const result = await uploader.complete(parts);
  console.log(
    `[warm-cache] Upload complete: ` +
    `${(zip.length / 1024 / 1024).toFixed(1)} MB in ${Date.now() - t0}ms → ${result.url}`
  );
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
  console.log(`[warm-cache] Cache entry saved for type=${type} deployId=${info.deployId}`);
}

// ─── workflow orchestrator ────────────────────────────────────────────────────

export async function buildDownloadCacheWorkflow(type: DownloadType) {
  "use workflow";

  console.log(`[warm-cache] Workflow started: type=${type} deploy=${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`);

  // For the full archive, bail early if PDFs haven't been ingested yet
  if (type === "full") {
    const pdfCount = await checkPdfAssets();
    if (pdfCount === 0) {
      console.log("[warm-cache] No PDFs ingested yet — skipping full cache build");
      return;
    }
  }

  const url = await buildAndUpload(type);
  await saveCache(type, url);

  console.log(`[warm-cache] Workflow complete: type=${type}`);
}
