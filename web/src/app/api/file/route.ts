import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const OBSIDIAN_DIR =
  process.env.OBSIDIAN_DIR ?? path.join(process.cwd(), "..", "obsidian");

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");

  if (!filePath) {
    return new NextResponse("Missing path parameter", { status: 400 });
  }

  // Only serve .pdf files through this route
  if (!filePath.endsWith(".pdf")) {
    return new NextResponse("Only PDF files are served via this route", { status: 400 });
  }

  // Prevent path traversal
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");

  // ── Local / disk path ──────────────────────────────────────────────────────
  const diskPath = path.join(OBSIDIAN_DIR, normalized);
  if (fs.existsSync(diskPath)) {
    const buf = fs.readFileSync(diskPath);
    const filename = path.basename(normalized);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // ── Production: look up in Convex pdfAssets, proxy through to strip Blob CSP ──
  try {
    const { fetchQuery } = await import("convex/nextjs");
    const { api } = await import("../../../../convex/_generated/api");
    const asset = await fetchQuery(api.documents.getPdfAssetByPath, { path: normalized });
    if (asset?.blobUrl) {
      const upstream = await fetch(asset.blobUrl);
      if (!upstream.ok) {
        return new NextResponse("Blob fetch failed", { status: 502 });
      }
      const filename = path.basename(normalized);
      return new NextResponse(upstream.body, {
        headers: {
          "Content-Type": "application/pdf",
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
