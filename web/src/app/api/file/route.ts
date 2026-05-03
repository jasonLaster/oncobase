import { NextRequest, NextResponse, connection } from "next/server";
import path from "path";
import { siteDataFromRequest } from "@/lib/site-data";

const MIME_TYPES: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".csv":  "text/csv; charset=utf-8",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
};

function getMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? null;
}

function getBlobToken() {
  return process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
}

async function fetchBlobAsset(normalizedPath: string, siteSlug: string) {
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

  const upstream = await fetch(blob.url);
  if (!upstream.ok) {
    return { error: new NextResponse("Blob fetch failed", { status: 502 }) };
  }

  return { buffer: Buffer.from(await upstream.arrayBuffer()) };
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

  try {
    const asset = ext === ".pdf"
      ? await siteData.documents.getPdfAssetByPath({ path: normalized })
      : await siteData.documents.getFileAssetByPath({ path: normalized });

    if (asset?.blobUrl) {
      const upstream = await fetch(asset.blobUrl);
      if (!upstream.ok) {
        return new NextResponse("Blob fetch failed", { status: 502 });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      return new NextResponse(buf, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  } catch (err) {
    console.error("[file] Convex lookup failed:", err);
  }

  try {
    const blob = await fetchBlobAsset(normalized, siteData.siteSlug);
    if (blob?.error) return blob.error;
    if (blob?.buffer) {
      return new NextResponse(blob.buffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  } catch (err) {
    console.error("[file] Blob fallback failed:", err);
  }

  return new NextResponse("File not found", { status: 404 });
}
