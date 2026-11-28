import path from "node:path";
import type { ConvexHttpClient } from "convex/browser";
import { isPrivateAssetStorageUrl, requiresPrivateAssetStorage, VERSIONED_PRIVATE_CACHE_CONTROL, WIKI_VERSION_HEADER, WIKI_VERSION_PARAM } from "@oncobase/wiki-content";
import { api } from "../../convex/_generated/api.js";
import { traceBackendPhase } from "../backend-tracing";
import { fetchBlob } from "../blob-fetch";
import { canReadEducationAsset, isEducationSlug } from "../education-access";
import { isWikiComponentAssetPath } from "@oncobase/wiki-markdown/mdx";
import { canUserAccessSlug, getSessionUser, hasValidAuthCookie, withSiteSlug } from "../reader-access";
import { blobRequestHeaders, normalizeFilePath } from "./common";

export const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".dcm": "application/dicom",
  ".dicom": "application/dicom",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gz": "application/gzip",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".tar": "application/x-tar",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

export function getMimeType(filePath: string) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

export function getBlobToken() {
  return process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
}

export async function recoverActiveFileAsset(
  request: Request,
  normalizedPath: string,
  siteSlug: string,
) {
  const token = getBlobToken();
  if (!token) return null;

  const { list } = await import("@vercel/blob");
  const pathnames = [
    `sites/${siteSlug}/files/${normalizedPath}`,
    `files/${normalizedPath}`,
  ];

  for (const pathname of pathnames) {
    const { blobs } = await list({
      limit: 1,
      prefix: pathname,
      token,
    });
    const blob = blobs.find((candidate) => candidate.pathname === pathname);
    if (!blob) continue;

    const upstream = await fetchBlob(blob.url, {
      headers: blobRequestHeaders(request),
      signal: request.signal,
    });
    if (upstream.ok || upstream.status === 416) return upstream;
  }

  return null;
}

export function assetPathToSiblingSlug(assetPath: string) {
  return assetPath.replace(/\.[^/.]+$/, "");
}

export function contentDisposition(ext: string, filename: string) {
  const disposition = ext === ".zip" ? "attachment" : "inline";
  return `${disposition}; filename="${filename}"`;
}

export const PRIVATE_FILE_DENIAL_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Accept, Cookie, Host, Range",
};

export function privateFileNotFound() {
  return new Response("File not found", {
    status: 404,
    headers: PRIVATE_FILE_DENIAL_HEADERS,
  });
}

/** The asset's validator: its content hash, or the Blob's own ETag. */
export function fileAssetEtag(contentHash: string | null | undefined) {
  return contentHash ? `"${contentHash.replace(/["\\]/g, "")}"` : null;
}

/** RFC 9110 weak comparison: `W/"x"` and `"x"` both match. */
export function ifNoneMatchMatches(request: Request, etag: string) {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header.split(",").some(candidate => {
    const tag = candidate.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

export function isStoredFileAssetSensitive(
  asset:
    | { ownerSlugs?: string[]; sensitive?: boolean }
    | null
    | undefined,
  siblingDocument: { sensitive?: boolean } | null | undefined,
) {
  if (
    !asset ||
    typeof asset.sensitive !== "boolean" ||
    !Array.isArray(asset.ownerSlugs)
  ) {
    return true;
  }
  return asset.sensitive || siblingDocument?.sensitive === true;
}

export async function handleFileRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
  educationOnly = false,
) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) return new Response("Missing path parameter", { status: 400 });

  const normalized = normalizeFilePath(filePath);
  // Every .html response carries a sandbox CSP below, so it never runs with the wiki origin.
  const mimeType = (isEducationSlug(normalized) || isWikiComponentAssetPath(normalized)) &&
    path.extname(normalized).toLowerCase() === ".html"
    ? "text/html; charset=utf-8" : getMimeType(normalized);
  if (!mimeType) return new Response("File type not supported", { status: 400 });

  const ext = path.extname(normalized).toLowerCase();
  // Browser navigation opens the application viewer; PDF.js and API clients
  // still receive the original bytes, including range responses. Every PDF
  // navigation redirects, before any lookup, so the redirect cannot disclose
  // whether a restricted asset exists. The viewer's own fetch is authorized
  // and, when denied, offers account sign-in instead of a bare 404.
  if (ext === ".pdf" && request.headers.get("Accept")?.includes("text/html") &&
      !url.searchParams.has("download") && !url.searchParams.has("raw") &&
      !request.headers.has("Range") && !educationOnly) {
    // `v` rides along so the viewer's own fetch is the versioned one (P11).
    const version = url.searchParams.get(WIKI_VERSION_PARAM);
    return new Response(null, { status: 302, headers: {
      Location: `/tools/pdf-viewer?path=${encodeURIComponent(normalized)}${version ? `&${WIKI_VERSION_PARAM}=${encodeURIComponent(version)}` : ""}`,
      ...PRIVATE_FILE_DENIAL_HEADERS,
    } });
  }

  const filename = path.basename(normalized);
  const [sessionUser, hasPasswordSession] = await Promise.all([
    getSessionUser(request, client, siteSlug),
    hasValidAuthCookie(request, client, siteSlug),
  ]);

  let siblingDoc;
  let asset;
  try {
    [siblingDoc, asset] = await Promise.all([
      client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, {
          slug: assetPathToSiblingSlug(normalized),
          includeSensitive: true,
        }),
      ),
      client.query(
        ext === ".pdf"
          ? api.documents.getPdfAssetByPath
          : api.documents.getFileAssetByPath,
        withSiteSlug(siteSlug, {
          path: normalized,
          includeSensitive: true,
        }),
      ),
    ]);
  } catch (error) {
    console.error("[file] Convex lookup failed:", error);
    return privateFileNotFound();
  }

  if (!asset?.blobUrl) return privateFileNotFound();

  const assetIsSensitive = isStoredFileAssetSensitive(asset, siblingDoc);
  if (educationOnly && (assetIsSensitive || !(await canReadEducationAsset(
    { ...asset, path: normalized },
    slug => client.query(api.documents.getBySlug, withSiteSlug(siteSlug, { slug, includeSensitive: false })),
  )))) {
    return privateFileNotFound();
  }
  if (assetIsSensitive) {
    const ownerSlugs = Array.from(
      new Set([
        ...(asset.ownerSlugs ?? []),
        ...(siblingDoc?.slug ? [siblingDoc.slug] : []),
      ]),
    );
    const canAccessEveryOwner = Boolean(
      sessionUser &&
        ownerSlugs.length > 0 &&
        (
          await Promise.all(
            ownerSlugs.map((slug) =>
              canUserAccessSlug(client, siteSlug, sessionUser, slug),
            ),
          )
        ).every(Boolean),
    );
    if (!canAccessEveryOwner) return privateFileNotFound();
  }

  const needsPrivateStorage = requiresPrivateAssetStorage(siteSlug, normalized);
  const blobHeaders = new Headers(blobRequestHeaders(request));
  if (needsPrivateStorage) {
    const token = process.env.WIKI_PRIVATE_READ_WRITE_TOKEN;
    const storeId = token?.split("_")[3]?.toLowerCase();
    const source = URL.parse(asset.blobUrl);
    if (!assetIsSensitive || !token || !storeId || !source || !isPrivateAssetStorageUrl(source) ||
        source.hostname !== `${storeId}.private.blob.vercel-storage.com`) {
      return privateFileNotFound();
    }
    blobHeaders.set("Authorization", `Bearer ${token}`);
  }

  const cacheScope = assetIsSensitive ? "session" : "public";
  // Cache privacy: any password-gated or signed-in request
  // gets a private response varying on Cookie, independent of RBAC scope.
  const privateCache =
    educationOnly ||
    assetIsSensitive ||
    Boolean(sessionUser) ||
    hasPasswordSession;

  // P11: `?v=` names the content. Only after the access checks above, and
  // only when it is exactly the stored hash, does the response cache for a
  // year; any other `v` is answered as if it were absent.
  const requestedVersion = url.searchParams.get(WIKI_VERSION_PARAM);
  const versionMatch = requestedVersion !== null && Boolean(asset.contentHash) &&
    requestedVersion === asset.contentHash;
  const cacheControl = versionMatch
    ? privateCache ? VERSIONED_PRIVATE_CACHE_CONTROL : "public, max-age=31536000, immutable"
    : privateCache ? "private, max-age=60, stale-while-revalidate=3600" : "public, max-age=86400";
  // A validated `?v=` response is the same bytes for every cookie this browser
  // can hold, so it does not vary on Cookie: the reader rewrites its own
  // cookies while navigating, and `Vary: Cookie` turned each rewrite into a
  // full refetch of every versioned image. Sign-out clears it (Clear-Site-Data).
  const vary = privateCache && !versionMatch ? "Accept, Cookie, Host, Range" : "Accept, Host, Range";
  const versionHeaders: Record<string, string> = requestedVersion === null ? {}
    : { [WIKI_VERSION_HEADER]: versionMatch ? "match" : "mismatch" };
  const etag = fileAssetEtag(asset.contentHash);
  // The stored hash validates the bytes without reading Blob.
  if (etag && ifNoneMatchMatches(request, etag)) {
    return new Response(null, { status: 304, headers: {
      "Cache-Control": cacheControl, ETag: etag, Vary: vary, "X-Wiki-Cache-Scope": cacheScope, ...versionHeaders,
    } });
  }

  let upstream: Response | null = null;
  const blobUrl = asset.blobUrl;
  try {
    upstream = await traceBackendPhase("external.blob", () => fetchBlob(blobUrl, {
      headers: blobHeaders,
      redirect: needsPrivateStorage ? "error" : undefined,
      signal: request.signal,
    }));
  } catch (error) {
    console.error("[file] Active Blob URL fetch failed:", error);
  }

  if (!needsPrivateStorage && (!upstream || (!upstream.ok && upstream.status !== 416))) {
    try {
      upstream = await recoverActiveFileAsset(request, normalized, siteSlug);
    } catch (error) {
      console.error("[file] Blob fallback failed:", error);
      upstream = null;
    }
  }

  if (!upstream || (!upstream.ok && upstream.status !== 416)) {
    return new Response("Blob fetch failed", {
      status: 502,
      headers: privateCache ? PRIVATE_FILE_DENIAL_HEADERS : undefined,
    });
  }

  const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Disposition": url.searchParams.has("download")
        ? `attachment; filename="${filename.replace(/["\r\n]/g, "")}"`
        : contentDisposition(ext, filename),
      "Cache-Control": cacheControl,
      Vary: vary,
      "X-Wiki-Cache-Scope": cacheScope,
      ...versionHeaders,
    });
  const upstreamEtag = upstream.headers.get("etag");
  if (etag ?? upstreamEtag) headers.set("ETag", (etag ?? upstreamEtag)!);
  const contentLength = upstream.headers.get("content-length");
  if (ext === ".html") {
    // Curriculum labs and MDX components run their scripts without receiving the wiki origin.
    headers.set("Content-Security-Policy", "sandbox allow-scripts allow-popups");
    headers.set("Content-Disposition", `inline; filename="${filename.replace(/["\r\n]/g, "")}"`);
  }
  if (contentLength) headers.set("Content-Length", contentLength);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
