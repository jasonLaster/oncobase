import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const OBSIDIAN_DIR =
  process.env.OBSIDIAN_DIR ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "..", "obsidian");

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

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");

  if (!filePath) {
    return new NextResponse("Missing path parameter", { status: 400 });
  }

  const mimeType = getMimeType(filePath);
  if (!mimeType) {
    return new NextResponse("File type not supported", { status: 400 });
  }

  // Prevent path traversal
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");

  const ext = path.extname(normalized).toLowerCase();
  const filename = path.basename(normalized);

  // ── Local / disk path ──────────────────────────────────────────────────────
  // Skip LFS pointer files — they start with "version https://git-lfs"
  const diskPath = path.join(/* turbopackIgnore: true */ OBSIDIAN_DIR, normalized);
  if (fs.existsSync(diskPath)) {
    const buf = fs.readFileSync(diskPath);
    const isLfsPointer = buf.length < 200 && buf.toString("utf8", 0, 40).includes("git-lfs");
    if (!isLfsPointer) {
      return new NextResponse(buf, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
    // LFS pointer — fall through to Convex lookup below
  }

  // ── Production: look up in Convex, proxy to strip Blob CSP ────────────────
  try {
    const { fetchQuery } = await import("convex/nextjs");
    const { api } = await import("../../../../convex/_generated/api");

    // PDFs live in pdfAssets; everything else in fileAssets
    const asset = ext === ".pdf"
      ? await fetchQuery(api.documents.getPdfAssetByPath, { path: normalized })
      : await fetchQuery(api.documents.getFileAssetByPath, { path: normalized });

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

  return new NextResponse("File not found", { status: 404 });
}
