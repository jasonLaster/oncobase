import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import archiver from "archiver";
import { addDirToDiskArchive } from "@/lib/archive-helpers";

export const maxDuration = 300;

const OBSIDIAN_DIR =
  process.env.OBSIDIAN_DIR ?? path.join(process.cwd(), "..", "obsidian");

// ─── archive stream builders ──────────────────────────────────────────────────

/**
 * Wraps archiver fill logic in a Web ReadableStream so the stream is unlocked
 * until the consumer calls getReader(). Avoids Readable.toWeb() timing and
 * backpressure issues.
 */
function archiverToStream(
  label: string,
  fill: (arc: archiver.Archiver) => void
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const arc = archiver("zip", { zlib: { level: 1 } });
      let bytesOut = 0;
      arc.on("data", (chunk: Buffer) => {
        bytesOut += chunk.byteLength;
        controller.enqueue(chunk);
      });
      arc.on("end", () => {
        console.log(`[download] ${label} stream ended — ${(bytesOut / 1024 / 1024).toFixed(1)} MB total`);
        controller.close();
      });
      arc.on("error", (err) => {
        console.error(`[download] ${label} stream error:`, err);
        controller.error(err);
      });
      arc.on("progress", (p) => {
        if (p.entries.processed % 50 === 0 && p.entries.processed > 0) {
          console.log(`[download] ${label} progress: ${p.entries.processed}/${p.entries.total} entries`);
        }
      });
      Promise.resolve(fill(arc)).catch((err) => {
        console.error(`[download] ${label} fill error:`, err);
        controller.error(err);
      });
    },
  });
}

function buildZipStreamFromDisk(): ReadableStream<Uint8Array> {
  console.log(`[download] Building zip from disk: ${OBSIDIAN_DIR}`);
  return archiverToStream("disk", (arc) => {
    addDirToDiskArchive(arc, OBSIDIAN_DIR);
    arc.finalize();
  });
}

// ─── Convex helpers ───────────────────────────────────────────────────────────

async function getConvexApi() {
  const { fetchQuery } = await import("convex/nextjs");
  const { api } = await import("../../../../convex/_generated/api");
  return { fetchQuery, api };
}

/** Full archive: PDFs from Blob + markdown from Convex */
function buildFullArchiveStream(token: string): ReadableStream<Uint8Array> {
  console.log("[download] Building full archive from Blob+Convex");
  return archiverToStream("full", async (arc) => {
    const { fetchQuery, api } = await getConvexApi();
    const { get } = await import("@vercel/blob");

    const pdfAssets = await fetchQuery(api.documents.listPdfAssets, {});
    console.log(`[download] Full archive: ${pdfAssets.length} PDF assets to fetch`);

    const BATCH = 20;
    let pdfsFetched = 0;
    let pdfsFailed = 0;

    for (let i = 0; i < pdfAssets.length; i += BATCH) {
      const batch = pdfAssets.slice(i, i + BATCH);
      const t0 = Date.now();
      const buffers = await Promise.all(
        batch.map(async (asset) => {
          try {
            const blobResult = await get(asset.blobUrl, { token, access: "private" });
            if (!blobResult?.stream) {
              console.warn(`[download] No stream for PDF: ${asset.path}`);
              return null;
            }
            const chunks: Buffer[] = [];
            const reader = blobResult.stream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(Buffer.from(value));
            }
            return { name: asset.path, buf: Buffer.concat(chunks) };
          } catch (err) {
            console.warn(`[download] Failed to fetch PDF ${asset.path}:`, err);
            return null;
          }
        })
      );
      for (const item of buffers) {
        if (item) { arc.append(item.buf, { name: item.name }); pdfsFetched++; }
        else pdfsFailed++;
      }
      console.log(
        `[download] PDF batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(pdfAssets.length / BATCH)}: ` +
        `${buffers.filter(Boolean).length}/${batch.length} fetched in ${Date.now() - t0}ms`
      );
    }

    console.log(`[download] PDFs complete: ${pdfsFetched} added, ${pdfsFailed} failed`);
    await appendMarkdownToArchive(arc, fetchQuery, api);
    arc.finalize();
  });
}

/** Markdown-only archive: just markdown from Convex */
function buildMarkdownArchiveStream(): ReadableStream<Uint8Array> {
  console.log("[download] Building markdown-only archive from Convex");
  return archiverToStream("markdown", async (arc) => {
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
  let pageNum = 0;
  let totalDocs = 0;
  const t0 = Date.now();

  while (!isDone) {
    const page = (await fetchQuery(api.documents.listPageWithContent, {
      cursor,
      numItems: 50,
    })) as ListPageWithContentResult;

    for (const doc of page.page) {
      if (doc.content) {
        arc.append(Buffer.from(doc.content, "utf-8"), { name: `${doc.slug}.md` });
        totalDocs++;
      }
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
    console.log(
      `[download] Markdown page ${++pageNum}: ${page.page.length} docs fetched ` +
      `(total=${totalDocs}, done=${isDone})`
    );
  }

  console.log(`[download] Markdown complete: ${totalDocs} docs in ${Date.now() - t0}ms`);
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
  const t0 = Date.now();
  try {
    const { fetchQuery, api } = await getConvexApi();
    const raw = await fetchQuery(api.documents.getMeta, { key: CACHE_KEYS[type] });
    const result = raw ? (JSON.parse(raw) as ZipCacheInfo) : null;
    console.log(
      `[download] Cache lookup for type=${type}: ${result ? "found" : "miss"} (${Date.now() - t0}ms)`
    );
    return result;
  } catch (err) {
    console.error(`[download] Cache lookup failed for type=${type}:`, err);
    return null;
  }
}

function isCacheFresh(info: ZipCacheInfo, type: DownloadType): boolean {
  if (info.url.includes(".private.blob.")) {
    console.log(`[download] Cache stale: private blob URL (type=${type})`);
    return false;
  }
  const deployId = process.env.VERCEL_DEPLOYMENT_ID ?? null;
  if (deployId && info.deployId !== deployId) {
    console.log(`[download] Cache stale: deployId mismatch (cached=${info.deployId} current=${deployId})`);
    return false;
  }
  const ageMs = Date.now() - info.builtAt;
  const fresh = ageMs < 24 * 60 * 60 * 1000;
  if (!fresh) {
    console.log(`[download] Cache stale: age ${Math.round(ageMs / 1000 / 60)}m > 24h`);
  }
  return fresh;
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

// ─── route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rawType = request.nextUrl.searchParams.get("type") ?? "full";
  const type: DownloadType = rawType === "markdown" ? "markdown" : "full";
  const deployId = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

  console.log(`[download] GET type=${type} deploy=${deployId}`);

  const token = process.env.BLOB_READ_WRITE_TOKEN;

  // ── Fast path: redirect to cached public Blob URL ──────────────────────────
  if (token) {
    const cached = await getCachedZipInfo(type);
    if (cached && isCacheFresh(cached, type)) {
      console.log(`[download] Fast path: redirecting to cached blob (${Date.now() - t0}ms)`);
      return NextResponse.redirect(cached.url);
    }
    console.log(`[download] Cache cold — falling through to slow path`);
  } else {
    console.warn("[download] BLOB_READ_WRITE_TOKEN not set — skipping cache check");
  }

  // ── Slow path: stream zip on-demand ────────────────────────────────────────
  const diskAvailable = !process.env.VERCEL && fs.existsSync(OBSIDIAN_DIR);
  console.log(`[download] Slow path: diskAvailable=${diskAvailable} type=${type}`);

  let zipStream: ReadableStream<Uint8Array>;
  if (diskAvailable) {
    zipStream = buildZipStreamFromDisk();
  } else if (!token) {
    console.error("[download] No disk and no BLOB_READ_WRITE_TOKEN — cannot serve download");
    return new NextResponse("Download unavailable: storage not configured", { status: 503 });
  } else if (type === "markdown") {
    zipStream = buildMarkdownArchiveStream();
  } else {
    zipStream = buildFullArchiveStream(token);
  }

  // Kick off background cache warm via the workflow
  // (fire-and-forget: don't await, don't block the response)
  if (token) {
    console.log(`[download] Scheduling background cache build for type=${type}`);
    import("workflow/api").then(({ start }) =>
      import("@/workflows/build-download-cache").then(({ buildDownloadCacheWorkflow }) =>
        start(buildDownloadCacheWorkflow, [type])
          .then((run) => console.log(`[download] Cache workflow started: ${run.runId}`))
          .catch((err) => console.error("[download] Failed to start cache workflow:", err))
      )
    );
  }

  console.log(`[download] Streaming response started (${Date.now() - t0}ms to first byte)`);
  return zipResponse(zipStream, type);
}
