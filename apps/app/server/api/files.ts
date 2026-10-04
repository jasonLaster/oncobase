import path from "node:path";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { traceBackendPhase } from "../backend-tracing";
import { fetchBlob } from "../blob-fetch";
import { canReadEducationAsset, isEducationSlug } from "../education-access";
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
  const mimeType = isEducationSlug(normalized) && path.extname(normalized).toLowerCase() === ".html"
    ? "text/html; charset=utf-8" : getMimeType(normalized);
  if (!mimeType) return new Response("File type not supported", { status: 400 });

  const ext = path.extname(normalized).toLowerCase();
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

  const cacheScope = assetIsSensitive ? "session" : "public";
  // Cache privacy: any password-gated or signed-in request
  // gets a private response varying on Cookie, independent of RBAC scope.
  const privateCache =
    educationOnly ||
    assetIsSensitive ||
    Boolean(sessionUser) ||
    hasPasswordSession;

  let upstream: Response | null = null;
  const blobUrl = asset.blobUrl;
  try {
    upstream = await traceBackendPhase("external.blob", () => fetchBlob(blobUrl, {
      headers: blobRequestHeaders(request),
      signal: request.signal,
    }));
  } catch (error) {
    console.error("[file] Active Blob URL fetch failed:", error);
  }

  if (!upstream || (!upstream.ok && upstream.status !== 416)) {
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
      "Content-Disposition": contentDisposition(ext, filename),
      "Cache-Control": privateCache
        ? "private, max-age=60, stale-while-revalidate=3600"
        : "public, max-age=86400",
      Vary: privateCache ? "Accept, Cookie, Host, Range" : "Accept, Host, Range",
      "X-Wiki-Cache-Scope": cacheScope,
    });
  const contentLength = upstream.headers.get("content-length");
  if (ext === ".html") {
    // Curriculum labs can run their scripts without receiving the wiki origin.
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
