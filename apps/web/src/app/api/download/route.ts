import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { api } from "@convex/_generated/api";
import {
  applyPiiRedactions,
  parseSitePiiPatterns,
  type PiiPattern,
} from "@/lib/pii-redaction";
import { getConvexServerClient } from "@/lib/convex-server";
import { siteDataFromRequest, type SiteData } from "@/lib/site-data";
import { DEFAULT_SITE_SLUG } from "@/lib/site";

export const maxDuration = 300;

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

// ─── Convex helpers ───────────────────────────────────────────────────────────

type DownloadAsset = {
  path: string;
  blobUrl: string;
};

/** Full archive: binary assets from public Blob + markdown from Convex */
function buildFullArchiveStream(
  siteData: SiteData,
  piiPatterns: PiiPattern[],
): ReadableStream<Uint8Array> {
  console.log(
    `[download] Building full archive from public Blob+Convex for site=${siteData.siteSlug}`,
  );
  return archiverToStream("full", async (arc) => {
    const [pdfAssets, fileAssets] = await Promise.all([
      siteData.documents.listPdfAssets(),
      siteData.documents.listFileAssets(),
    ]);
    const assets = [...pdfAssets, ...fileAssets] as DownloadAsset[];
    console.log(`[download] Full archive: ${assets.length} binary assets to fetch`);

    const BATCH = 20;
    let assetsFetched = 0;
    let assetsFailed = 0;

    for (let i = 0; i < assets.length; i += BATCH) {
      const batch = assets.slice(i, i + BATCH);
      const t0 = Date.now();
      const buffers = await Promise.all(
        batch.map(async (asset) => {
          try {
            const res = await fetch(asset.blobUrl);
            if (!res.ok) {
              console.warn(`[download] Failed to fetch asset ${asset.path}: ${res.status}`);
              return null;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            return { name: asset.path, buf };
          } catch (err) {
            console.warn(`[download] Failed to fetch asset ${asset.path}:`, err);
            return null;
          }
        })
      );
      for (const item of buffers) {
        if (item) { arc.append(item.buf, { name: item.name }); assetsFetched++; }
        else assetsFailed++;
      }
      console.log(
        `[download] Asset batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(assets.length / BATCH)}: ` +
        `${buffers.filter(Boolean).length}/${batch.length} fetched in ${Date.now() - t0}ms`
      );
    }

    console.log(`[download] Assets complete: ${assetsFetched} added, ${assetsFailed} failed`);
    await appendMarkdownToArchive(arc, siteData, piiPatterns);
    arc.finalize();
  });
}

/** Markdown-only archive: just markdown from Convex */
function buildMarkdownArchiveStream(
  siteData: SiteData,
  piiPatterns: PiiPattern[],
): ReadableStream<Uint8Array> {
  console.log(
    `[download] Building markdown-only archive from Convex for site=${siteData.siteSlug}`,
  );
  return archiverToStream("markdown", async (arc) => {
    await appendMarkdownToArchive(arc, siteData, piiPatterns);
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
  siteData: SiteData,
  piiPatterns: PiiPattern[],
) {
  let cursor: string | null = null;
  let isDone = false;
  let pageNum = 0;
  let totalDocs = 0;
  const t0 = Date.now();

  while (!isDone) {
    const page = (await siteData.documents.listPageWithContent({
      cursor,
      numItems: 50,
    })) as ListPageWithContentResult;

    for (const doc of page.page) {
      if (doc.content) {
        const content = applyPiiRedactions(doc.content, {
          patterns: piiPatterns,
        });
        arc.append(Buffer.from(content, "utf-8"), { name: `${doc.slug}.md` });
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

function contentDisposition(type: DownloadType, siteSlug: string) {
  const sitePart = siteSlug === DEFAULT_SITE_SLUG ? "diana-tnbc" : siteSlug;
  const suffix = type === "full" ? "full" : "markdown";
  return `attachment; filename="${sitePart}-wiki-${suffix}.zip"`;
}

interface ZipCacheInfo {
  url: string;
  builtAt: number;
  deployId: string | null;
}

async function getCachedZipInfo(type: DownloadType, siteData: SiteData): Promise<ZipCacheInfo | null> {
  const t0 = Date.now();
  try {
    const raw = await siteData.documents.getMeta({
      key: CACHE_KEYS[type],
    });
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

function zipResponse(
  stream: ReadableStream<Uint8Array>,
  type: DownloadType,
  siteSlug: string,
): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(type, siteSlug),
    },
  });
}

function scheduleBackgroundCacheBuild(type: DownloadType, siteSlug: string) {
  if (
    !process.env.PUBLIC_BLOB_READ_WRITE_TOKEN &&
    !process.env.BLOB_READ_WRITE_TOKEN
  ) {
    return false;
  }

  console.log(`[download] Scheduling background cache build for type=${type}`);
  import("workflow/api").then(({ start }) =>
    import("@/workflows/build-download-cache").then(({ buildDownloadCacheWorkflow }) =>
      start(buildDownloadCacheWorkflow, [type, siteSlug])
        .then((run) => console.log(`[download] Cache workflow started: ${run.runId}`))
        .catch((err) => console.error("[download] Failed to start cache workflow:", err))
    )
  );
  return true;
}

function warmingResponse(siteSlug: string) {
  return NextResponse.json(
    {
      message:
        "The full wiki download is being prepared. Please try again in a few minutes.",
      retryAfterSeconds: 600,
      siteSlug,
    },
    {
      status: 202,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "600",
      },
    },
  );
}

// ─── route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rawType = request.nextUrl.searchParams.get("type") ?? "full";
  const type: DownloadType = rawType === "markdown" ? "markdown" : "full";
  const deployId = process.env.VERCEL_DEPLOYMENT_ID ?? "local";
  const siteData = siteDataFromRequest(request);
  const siteSlug = siteData.siteSlug;

  console.log(`[download] GET site=${siteSlug} type=${type} deploy=${deployId}`);

  // ── Fast path: redirect to cached public Blob URL ──────────────────────────
  const cached = await getCachedZipInfo(type, siteData);
  if (cached && isCacheFresh(cached, type)) {
    console.log(`[download] Fast path: redirecting to cached blob (${Date.now() - t0}ms)`);
    return NextResponse.redirect(cached.url);
  }
  console.log(`[download] Cache cold`);

  const warmingStarted = scheduleBackgroundCacheBuild(type, siteSlug);

  if (type === "full" && warmingStarted) {
    console.log(
      `[download] Full cache cold — returning warming response (${Date.now() - t0}ms)`,
    );
    return warmingResponse(siteSlug);
  }

  // Resolve site-scoped PII patterns once per request.
  const site = await getConvexServerClient().query(api.sites.getBySlug, {
    slug: siteSlug,
  });
  const piiPatterns = parseSitePiiPatterns(site?.config.piiPatterns);

  const zipStream =
    type === "markdown"
      ? buildMarkdownArchiveStream(siteData, piiPatterns)
      : buildFullArchiveStream(siteData, piiPatterns);

  console.log(`[download] Streaming response started (${Date.now() - t0}ms to first byte)`);
  return zipResponse(zipStream, type, siteSlug);
}
