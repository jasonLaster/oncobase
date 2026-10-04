import archiver from "archiver";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { DEFAULT_SITE_SLUG, type SessionUser, getSessionUser, redactText, withSiteSlug } from "../reader-access";
import { fetchAccessibleSlugs, fetchSlugSensitivity } from "../slug-batch";
import { normalizeFilePath } from "./common";
import { filterAccessiblePages, type PageDownloadResult } from "./documents";

// Archive generation scans the same corpus; avoid serial network pages while
// preserving Convex's own byte-bounded pagination for large sites.
export const DOWNLOAD_DOCUMENT_PAGE_SIZE = 500;
// Per-asset ceiling while building a zip; one stalled Blob read must not
// hold the archive (and the function) open indefinitely.
export const DOWNLOAD_ASSET_TIMEOUT_MS = 60_000;

export type DownloadAsset = {
  blobUrl?: string;
  path: string;
};

export function archiverToStream(
  label: string,
  fill: (arc: archiver.Archiver) => Promise<void>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const arc = archiver("zip", { zlib: { level: 1 } });
      arc.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      arc.on("end", () => controller.close());
      arc.on("error", (error) => {
        console.error(`[download] ${label} archive stream error`, error);
        controller.error(error);
      });
      fill(arc).catch((error) => {
        console.error(`[download] ${label} archive fill error`, error);
        controller.error(error);
      });
    },
  });
}

export function archiveFilename(type: "full" | "markdown", siteSlug: string) {
  const sitePart = siteSlug === DEFAULT_SITE_SLUG ? "diana-tnbc" : siteSlug;
  return `${sitePart}-wiki-${type}.zip`;
}

export function archiveEntryPath(filePath: string) {
  return normalizeFilePath(filePath).replace(/^\/+/, "") || "file";
}

export async function appendMarkdownToArchive(
  arc: archiver.Archiver,
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
  sessionUser: SessionUser | null,
  maxPages: number,
) {
  let cursor: string | null = null;
  let isDone = false;
  let totalDocs = 0;

  while (!isDone && totalDocs < maxPages) {
    const numItems = Math.min(DOWNLOAD_DOCUMENT_PAGE_SIZE, maxPages - totalDocs);
    const args = includeSensitive
      ? { cursor, numItems, includeSensitive: true as const }
      : { cursor, numItems };
    const result: PageDownloadResult = await client.query(
      api.documents.listPageWithContent,
      withSiteSlug(siteSlug, args),
    );

    const visiblePages = await filterAccessiblePages(client, siteSlug, sessionUser, result.page);
    for (const page of visiblePages) {
      if (!page.content) continue;
      const content = await redactText(client, siteSlug, page.content);
      arc.append(Buffer.from(content, "utf-8"), { name: `${page.slug}.md` });
      totalDocs++;
      if (totalDocs >= maxPages) break;
    }

    isDone = result.isDone;
    cursor = result.continueCursor;
    if (!isDone && !cursor) {
      throw new Error("Download pagination failed");
    }
  }
}

export async function appendAssetsToArchive(
  arc: archiver.Archiver,
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
  sessionUser: SessionUser | null,
  maxAssets: number,
) {
  const args = withSiteSlug(
    siteSlug,
    includeSensitive ? { includeSensitive: true as const } : {},
  );
  const collected: DownloadAsset[] = [];
  for (const queryRef of [api.documents.listPdfAssetsPage, api.documents.listFileAssetsPage]) {
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone && collected.length < maxAssets) {
      const result = (await client.query(queryRef, {
        ...args,
        cursor,
        numItems: Math.min(500, maxAssets - collected.length),
      })) as { page: DownloadAsset[]; isDone: boolean; continueCursor: string | null };
      collected.push(...result.page);
      isDone = result.isDone;
      cursor = result.continueCursor;
      if (!isDone && !cursor) break;
    }
  }
  const siblingSlug = (asset: DownloadAsset) => asset.path.replace(/\.[^/.]+$/, "");
  const sensitivity = await fetchSlugSensitivity(client, siteSlug, collected.map(siblingSlug));
  const allowed = await fetchAccessibleSlugs(
    client,
    siteSlug,
    sessionUser,
    collected.map(siblingSlug).filter((slug) => sensitivity.get(slug) === true),
  );
  const assets = collected.filter((asset) => {
    const slug = siblingSlug(asset);
    return sensitivity.get(slug) !== true || allowed.has(slug);
  });

  for (const asset of assets.slice(0, maxAssets)) {
    if (!asset.blobUrl) continue;
    try {
      // Buffered into the archive, so bound the whole read, not just headers.
      const response = await fetch(asset.blobUrl, { signal: AbortSignal.timeout(DOWNLOAD_ASSET_TIMEOUT_MS) });
      if (!response.ok) {
        console.warn(`[download] Failed to fetch asset ${asset.path}: ${response.status}`);
        continue;
      }
      arc.append(Buffer.from(await response.arrayBuffer()), {
        name: archiveEntryPath(asset.path),
      });
    } catch (error) {
      console.warn(`[download] Failed to fetch asset ${asset.path}`, error);
    }
  }
}

export async function handleDownloadRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "markdown" ? "markdown" : "full";
  const scope = url.searchParams.get("scope");
  const sessionUser = scope === "public"
    ? null
    : await getSessionUser(request, client, siteSlug);
  const includeSensitive = Boolean(sessionUser);
  const rawLimit = Number(url.searchParams.get("limit") ?? 0);
  const maxPages = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(5000, Math.floor(rawLimit))
    : Number.POSITIVE_INFINITY;
  const rawAssetLimit = Number(url.searchParams.get("assetLimit") ?? 0);
  const maxAssets = Number.isFinite(rawAssetLimit) && rawAssetLimit > 0
    ? Math.min(5000, Math.floor(rawAssetLimit))
    : Number.POSITIVE_INFINITY;

  const stream = archiverToStream(type, async (arc) => {
    if (type === "full") {
      await appendAssetsToArchive(arc, client, siteSlug, includeSensitive, sessionUser, maxAssets);
    }
    await appendMarkdownToArchive(arc, client, siteSlug, includeSensitive, sessionUser, maxPages);
    await arc.finalize();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archiveFilename(type, siteSlug)}"`,
      "Cache-Control": includeSensitive
        ? "private, no-store"
        : "public, max-age=300, s-maxage=3600",
      Vary: includeSensitive ? "Accept, Cookie, Host" : "Accept, Host",
      "X-Wiki-Cache-Scope": includeSensitive ? "session" : "public",
    },
  });
}
