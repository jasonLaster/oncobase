import { NextRequest, NextResponse, connection } from "next/server";
import path from "path";
import { siteDataFromRequest } from "@/lib/site-data";
import { getSessionUserFromRequest } from "@/lib/session-user";

const MIME_TYPES: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".csv":  "text/csv; charset=utf-8",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".zip":  "application/zip",
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

function blobRequestHeaders(request: NextRequest) {
  const range = request.headers.get("Range");
  return range ? { Range: range } : undefined;
}

function streamBlobResponse({
  ext,
  filename,
  mimeType,
  sizeBytes,
  upstream,
}: {
  ext: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  upstream: Response;
}) {
  const headers = new Headers({
    "Cache-Control": "public, max-age=86400",
    "Content-Disposition": contentDisposition(ext, filename),
    "Content-Type": mimeType,
    "Vary": "Range",
  });

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  } else if (sizeBytes && upstream.status !== 206) {
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
  if (!upstream.ok) {
    return { error: new NextResponse("Blob fetch failed", { status: 502 }) };
  }

  return {
    response: streamBlobResponse({
      ext,
      filename,
      mimeType,
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
  const includeSensitive = Boolean(await getSessionUserFromRequest(request));
  const siblingDoc = await siteData.documents.getBySlug({
    slug: assetPathToSiblingSlug(normalized),
    includeSensitive: true,
  });
  if (!includeSensitive && siblingDoc?.sensitive) {
    return new NextResponse("File not found", { status: 404 });
  }

  try {
    const asset = ext === ".pdf"
      ? await siteData.documents.getPdfAssetByPath(
          includeSensitive
            ? { path: normalized, includeSensitive: true }
            : { path: normalized },
        )
      : await siteData.documents.getFileAssetByPath(
          includeSensitive
            ? { path: normalized, includeSensitive: true }
            : { path: normalized },
        );

    if (asset?.blobUrl) {
      const upstream = await fetch(asset.blobUrl, {
        headers: blobRequestHeaders(request),
      });
      if (!upstream.ok) {
        return new NextResponse("Blob fetch failed", { status: 502 });
      }
      return streamBlobResponse({
        ext,
        filename,
        mimeType,
        sizeBytes: asset.sizeBytes,
        upstream,
      });
    }
  } catch (err) {
    console.error("[file] Convex lookup failed:", err);
  }

  try {
    const blob = await fetchBlobAsset(
      request,
      normalized,
      siteData.siteSlug,
      ext,
      filename,
      mimeType,
    );
    if (blob?.error) return blob.error;
    if (blob?.response) return blob.response;
  } catch (err) {
    console.error("[file] Blob fallback failed:", err);
  }

  return new NextResponse("File not found", { status: 404 });
}
