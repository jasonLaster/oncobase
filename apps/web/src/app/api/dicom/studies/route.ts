import { NextResponse } from "next/server";

import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { getDicomCatalog } from "@/lib/dicom-local";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteSlug = url.searchParams.get("site") ?? undefined;
  const blobCatalog = await getBlobCatalog(siteSlug);
  if (blobCatalog) {
    return NextResponse.json(blobCatalog, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const catalog = await getDicomCatalog();

  return NextResponse.json(catalog, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function getBlobCatalog(siteSlug: string | undefined) {
  try {
    const rows = await getConvexServerClient().query(api.dicom.listSeries, {
      siteSlug,
    });
    if (!rows.length) return null;

    return {
      root: "vercel-blob",
      rootsTried: ["vercel-blob"],
      series: rows.map((series) => ({
        id: series._id,
        seriesKey: series.seriesKey,
        label: series.label,
        root: "vercel-blob",
        directory: series.relativeDirectory,
        relativeDirectory: series.relativeDirectory,
        modality: series.modality ?? null,
        studyDescription: series.studyDescription ?? null,
        seriesDescription: series.seriesDescription ?? null,
        studyDate: series.studyDate ?? null,
        seriesNumber: series.seriesNumber ?? null,
        images: series.images.map((image, index) => ({
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
          sortIndex: index,
        })),
      })),
    };
  } catch (error) {
    console.warn("[dicom] Blob-backed catalog unavailable; falling back to local files", error);
    return null;
  }
}
