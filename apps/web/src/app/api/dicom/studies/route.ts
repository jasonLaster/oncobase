import { NextResponse } from "next/server";

import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { getDicomCatalog } from "@/lib/dicom-local";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteSlug = url.searchParams.get("site") ?? undefined;
  const relativeDirectoryIncludes = [
    ...new Set(
      url.searchParams
        .getAll("directory")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const blobCatalog = await getBlobCatalog(siteSlug, relativeDirectoryIncludes);
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

async function getBlobCatalog(
  siteSlug: string | undefined,
  relativeDirectoryIncludes: string[],
) {
  try {
    const convex = getConvexServerClient();
    const rows = relativeDirectoryIncludes.length
      ? (
          await Promise.all(
            relativeDirectoryIncludes.map((directory) =>
              convex.query(api.dicom.listSeries, {
                siteSlug,
                relativeDirectoryIncludes: directory,
                includeImages: false,
              }),
            ),
          )
        ).flat()
      : await convex.query(api.dicom.listSeries, {
          siteSlug,
          includeImages: true,
        });
    if (!rows.length) return null;

    const uniqueRows = [
      ...new Map(rows.map((series) => [series.seriesKey, series])).values(),
    ];

    return {
      root: "vercel-blob",
      rootsTried: ["vercel-blob"],
      series: uniqueRows.map((series) => ({
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
        imageCount: series.imageCount,
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
          pixelSpacing: image.pixelSpacing ?? null,
          sortIndex: index,
        })),
      })),
    };
  } catch (error) {
    console.warn("[dicom] Blob-backed catalog unavailable; falling back to local files", error);
    return null;
  }
}
