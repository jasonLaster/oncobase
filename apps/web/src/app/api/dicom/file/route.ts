import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { resolveDicomPath } from "@/lib/dicom-local";

export async function GET(request: NextRequest) {
  const relativePath = request.nextUrl.searchParams.get("path") ?? "";
  const siteSlug = request.nextUrl.searchParams.get("site") ?? undefined;
  const blobResponse = await fetchBlobDicom(relativePath, siteSlug);
  if (blobResponse) return blobResponse;

  const resolved = await resolveDicomPath(relativePath);

  if (!resolved) {
    return NextResponse.json({ error: "DICOM file not found" }, { status: 404 });
  }

  try {
    const data = await fs.readFile(resolved.absolutePath);
    return new Response(data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${path.basename(resolved.absolutePath)}"`,
        "Content-Length": String(data.byteLength),
        "Content-Type": "application/dicom",
      },
    });
  } catch {
    return NextResponse.json({ error: "DICOM file not readable" }, { status: 404 });
  }
}

async function fetchBlobDicom(relativePath: string, siteSlug: string | undefined) {
  try {
    const row = await getConvexServerClient().query(api.dicom.getImageByPath, {
      siteSlug,
      path: relativePath,
    });
    if (!row) return null;

    const upstream = await fetch(row.blobUrl);
    if (!upstream.ok) return null;

    return new Response(upstream.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${row.fileName}"`,
        "Content-Length": upstream.headers.get("content-length") ?? String(row.sizeBytes),
        "Content-Type": upstream.headers.get("content-type") ?? "application/dicom",
      },
    });
  } catch (error) {
    console.warn("[dicom] Blob-backed file unavailable; falling back to local file", error);
    return null;
  }
}
