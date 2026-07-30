import { NextRequest, NextResponse, connection } from "next/server";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "path";
import { Readable } from "node:stream";
import { siteDataFromRequest } from "@/lib/site-data";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { isStoredAssetSensitive } from "@/lib/asset-visibility";
import { diagnosticsRootCandidates } from "@/lib/local-diagnostics-paths";
import {
  hasValidWikiGateCookie,
  wikiGateCookieName,
} from "@/lib/wiki-gate-session";

const MIME_TYPES: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".dcm": "application/dicom",
  ".dicom": "application/dicom",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gz": "application/gzip",
  ".csv":  "text/csv; charset=utf-8",
  ".json": "application/json",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".gif":  "image/gif",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
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

function getMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? null;
}

function getBlobToken() {
  return process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
}

function assetPathToSiblingSlug(assetPath: string) {
  return assetPath.replace(/\.[^/.]+$/, "");
}

function contentDisposition(ext: string, filename: string) {
  const disposition = ext === ".zip" ? "attachment" : "inline";
  return `${disposition}; filename="${filename}"`;
}

function hasSitePasswordSession(request: NextRequest, siteSlug: string) {
  return hasValidWikiGateCookie(
    siteSlug,
    request.cookies.get(wikiGateCookieName(siteSlug))?.value,
  );
}

const PRIVATE_FILE_DENIAL_HEADERS = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie, Host",
};

function privateFileNotFound() {
  return new NextResponse("File not found", {
    status: 404,
    headers: PRIVATE_FILE_DENIAL_HEADERS,
  });
}

function blobRequestHeaders(request: NextRequest) {
  const range = request.headers.get("Range");
  return range ? { Range: range } : undefined;
}

async function findDiagnosticsRoot() {
  for (const candidate of diagnosticsRootCandidates()) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) return candidate;
    } catch {
      // Local roots vary by checkout; keep trying the next candidate.
    }
  }
  return null;
}

async function resolveLocalViewerUploadPath(normalizedPath: string) {
  if (process.env.NODE_ENV === "production") return null;
  const prefix = "diagnostics/viewer-upload/";
  if (!normalizedPath.startsWith(prefix)) return null;

  const root = await findDiagnosticsRoot();
  if (!root) return null;

  const uploadRelativePath = normalizedPath.slice(prefix.length);
  const uploadRoot = path.join(root, "_deidentified-viewer-upload");
  const absolutePath = path.resolve(uploadRoot, uploadRelativePath);
  const relativeToUploadRoot = path.relative(uploadRoot, absolutePath);
  if (relativeToUploadRoot.startsWith("..") || path.isAbsolute(relativeToUploadRoot)) {
    return null;
  }

  try {
    const stats = await fs.stat(absolutePath);
    return stats.isFile() ? { absolutePath, sizeBytes: stats.size } : null;
  } catch {
    return null;
  }
}

function parseRangeHeader(range: string | null, sizeBytes: number) {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return "invalid" as const;

  const [, startText, endText] = match;
  if (!startText && !endText) return "invalid" as const;

  let start: number;
  let end: number;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid" as const;
    }
    start = Math.max(sizeBytes - suffixLength, 0);
    end = sizeBytes - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : sizeBytes - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) {
    return "invalid" as const;
  }

  return { start, end: Math.min(end, sizeBytes - 1) };
}

async function localFileResponse({
  absolutePath,
  ext,
  filename,
  mimeType,
  request,
  sizeBytes,
}: {
  absolutePath: string;
  ext: string;
  filename: string;
  mimeType: string;
  request: NextRequest;
  sizeBytes: number;
}) {
  const range = parseRangeHeader(request.headers.get("Range"), sizeBytes);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60, stale-while-revalidate=3600",
    "Content-Disposition": contentDisposition(ext, filename),
    "Content-Type": mimeType,
    "Vary": "Cookie, Range",
  });

  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${sizeBytes}`);
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    headers.set("Content-Length", String(contentLength));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${sizeBytes}`);
    const stream = createReadStream(absolutePath, {
      start: range.start,
      end: range.end,
    });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(sizeBytes));
  return new Response(
    Readable.toWeb(createReadStream(absolutePath)) as unknown as ReadableStream,
    {
      headers,
    },
  );
}

function streamBlobResponse({
  ext,
  filename,
  mimeType,
  privateCache,
  sizeBytes,
  upstream,
}: {
  ext: string;
  filename: string;
  mimeType: string;
  privateCache: boolean;
  sizeBytes?: number;
  upstream: Response;
}) {
  const headers = new Headers({
    "Cache-Control": privateCache
      ? "private, max-age=60, stale-while-revalidate=3600"
      : "public, max-age=86400",
    "Content-Disposition": contentDisposition(ext, filename),
    "Content-Type": mimeType,
    "Vary": privateCache ? "Cookie, Range" : "Range",
  });

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  } else if (
    sizeBytes &&
    upstream.status !== 206 &&
    upstream.status !== 416
  ) {
    headers.set("Content-Length", String(sizeBytes));
  }

  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);

  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function fetchBlobAsset(
  request: NextRequest,
  normalizedPath: string,
  siteSlug: string,
  ext: string,
  filename: string,
  mimeType: string,
  privateCache: boolean,
) {
  const token = getBlobToken();
  if (!token) return null;

  const { list } = await import("@vercel/blob");
  const pathnames = [
    `sites/${siteSlug}/files/${normalizedPath}`,
    `files/${normalizedPath}`,
  ];
  let blob: { url: string } | undefined;
  for (const pathname of pathnames) {
    const { blobs } = await list({
      limit: 1,
      prefix: pathname,
      token,
    });
    blob = blobs.find((candidate) => candidate.pathname === pathname);
    if (blob) break;
  }
  if (!blob) return null;

  const upstream = await fetch(blob.url, {
    headers: blobRequestHeaders(request),
  });
  if (!upstream.ok && upstream.status !== 416) {
    return {
      error: new NextResponse("Blob fetch failed", {
        status: 502,
        headers: privateCache ? PRIVATE_FILE_DENIAL_HEADERS : undefined,
      }),
    };
  }

  return {
    response: streamBlobResponse({
      ext,
      filename,
      mimeType,
      privateCache,
      upstream,
    }),
  };
}

export async function GET(request: NextRequest) {
  await connection();

  const filePath = request.nextUrl.searchParams.get("path");

  if (!filePath) {
    return new NextResponse("Missing path parameter", { status: 400 });
  }

  const mimeType = getMimeType(filePath);
  if (!mimeType) {
    return new NextResponse("File type not supported", { status: 400 });
  }

  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const ext = path.extname(normalized).toLowerCase();
  const filename = path.basename(normalized);

  const siteData = siteDataFromRequest(request);
  const [hasPasswordSession, sessionUser] = await Promise.all([
    hasSitePasswordSession(request, siteData.siteSlug),
    getSessionUserFromRequest(request),
  ]);
  const privateCache = hasPasswordSession || Boolean(sessionUser);

  let siblingDoc: Awaited<
    ReturnType<typeof siteData.documents.getBySlug>
  > = null;
  let asset: Awaited<
    ReturnType<typeof siteData.documents.getPdfAssetByPath>
  > = null;
  let assetLookupFailed = false;
  try {
    siblingDoc = await siteData.documents.getBySlug({
      slug: assetPathToSiblingSlug(normalized),
      includeSensitive: true,
    });
    asset = ext === ".pdf"
      ? await siteData.documents.getPdfAssetByPath(
          { path: normalized, includeSensitive: true },
        )
      : await siteData.documents.getFileAssetByPath(
          { path: normalized, includeSensitive: true },
        );
  } catch (err) {
    console.error("[file] Convex lookup failed:", err);
    assetLookupFailed = true;
  }

  const assetIsSensitive =
    !assetLookupFailed && isStoredAssetSensitive(asset, siblingDoc);
  if (assetIsSensitive) {
    const ownerSlugs = Array.from(
      new Set([
        ...(asset?.ownerSlugs ?? []),
        ...(siblingDoc?.slug ? [siblingDoc.slug] : []),
      ]),
    );
    const canAccessEveryOwner = Boolean(
      sessionUser &&
        ownerSlugs.length > 0 &&
        (
          await Promise.all(
            ownerSlugs.map((slug) =>
              siteData.access.canUserAccessSlug({
                userId: sessionUser._id,
                slug,
              }),
            ),
          )
        ).every(Boolean),
    );
    if (!canAccessEveryOwner) return privateFileNotFound();
  }

  if (!assetLookupFailed && asset?.blobUrl) {
    const upstream = await fetch(asset.blobUrl, {
      headers: blobRequestHeaders(request),
    });
    if (upstream.ok || upstream.status === 416) {
      return streamBlobResponse({
        ext,
        filename,
        mimeType,
        privateCache,
        sizeBytes: asset.sizeBytes,
        upstream,
      });
    }

    try {
      const blob = await fetchBlobAsset(
        request,
        normalized,
        siteData.siteSlug,
        ext,
        filename,
        mimeType,
        privateCache,
      );
      if (blob?.error) return blob.error;
      if (blob?.response) return blob.response;
    } catch (err) {
      console.error("[file] Blob fallback failed:", err);
    }

    return new NextResponse("Blob fetch failed", {
      status: 502,
      headers: privateCache ? PRIVATE_FILE_DENIAL_HEADERS : undefined,
    });
  }

  if (sessionUser) {
    const localViewerUpload = await resolveLocalViewerUploadPath(normalized);
    if (localViewerUpload) {
      return localFileResponse({
        absolutePath: localViewerUpload.absolutePath,
        ext,
        filename,
        mimeType,
        request,
        sizeBytes: localViewerUpload.sizeBytes,
      });
    }
  }

  return privateFileNotFound();
}
