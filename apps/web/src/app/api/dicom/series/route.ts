import { NextResponse } from "next/server";

import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteSlug = url.searchParams.get("site") ?? undefined;
  const seriesKey = url.searchParams.get("key")?.trim();
  if (!seriesKey) {
    return NextResponse.json({ error: "Missing series key" }, { status: 400 });
  }

  const images = await getConvexServerClient().query(api.dicom.listSeriesImages, {
    siteSlug,
    seriesKey,
  });

  return NextResponse.json(
    {
      images: images.map((image, index) => ({
        id: image._id,
        fileName: image.fileName,
        relativePath: image.path,
        byteLength: image.sizeBytes,
        modifiedAt: new Date(image.uploadedAt).toISOString(),
        imageId: `/api/dicom/file?path=${encodeURIComponent(image.path)}`,
        instanceNumber: image.instanceNumber ?? null,
        imagePosition: image.imagePosition ?? null,
        rows: image.rows ?? null,
        columns: image.columns ?? null,
        pixelSpacing: image.pixelSpacing ?? null,
        sortIndex: index,
      })),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
