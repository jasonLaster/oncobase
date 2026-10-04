import path from "node:path";
import type { ConvexHttpClient } from "convex/browser";
import {
  prepareDiagnosticTimelineResponse,
  type DiagnosticTimelineData,
} from "@oncobase/diagnostics/timeline/data";
import {
  diagnosticStudiesMetaKeyForSet,
  normalizeDiagnosticStudiesPayload,
  normalizeDiagnosticStudySet,
  parseDiagnosticStudiesPayload,
} from "@oncobase/diagnostics/studies/data";
import {
  diagnosticComparisonsMetaKeyForSet,
  normalizeDiagnosticComparisonSet,
  normalizeDiagnosticComparisonsPayload,
  parseDiagnosticComparisonsPayload,
} from "@oncobase/diagnostics/dicom/comparisons";
import {
  resolveDicomPath,
  getDicomCatalog,
} from "@oncobase/diagnostics/dicom/local";
import { api } from "../../convex/_generated/api.js";
import { traceBackendPhase } from "../backend-tracing";
import { fetchBlob } from "../blob-fetch";
import { withSiteSlug } from "../reader-access";
import { blobRequestHeaders } from "./common";

export const TIMELINE_META_KEY = "diagnosticTimeline:data";

export async function handleDicomStudiesRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    const url = new URL(request.url);
    const directories = [
      ...new Set(
        url.searchParams
          .getAll("directory")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    const rows = directories.length
      ? (
          await Promise.all(
            directories.map((directory) =>
              client.query(api.dicom.listSeries, {
                siteSlug,
                relativeDirectoryIncludes: directory,
                includeImages: false,
              }),
            ),
          )
        ).flat()
      : await client.query(api.dicom.listSeries, {
          siteSlug,
          includeImages: false,
        });
    if (rows.length) {
      const uniqueRows = [
        ...new Map(rows.map((series) => [series.seriesKey, series])).values(),
      ];
      return Response.json(
        {
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
        },
        {
          headers: {
            "Cache-Control": "no-store",
            Vary: "Host",
          },
        },
      );
    }
  } catch (error) {
    console.warn("[dicom] Blob-backed catalog unavailable; falling back to local files", error);
  }

  const catalog = await getDicomCatalog();
  return Response.json(catalog, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "Host",
    },
  });
}

export async function handleDicomSeriesRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const seriesKey = new URL(request.url).searchParams.get("key")?.trim();
  if (!seriesKey) {
    return Response.json({ error: "Missing series key" }, { status: 400 });
  }

  const images = await client.query(api.dicom.listSeriesImages, {
    siteSlug,
    seriesKey,
  });
  return Response.json(
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
        Vary: "Host",
      },
    },
  );
}

export async function handleDicomFileRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const relativePath = new URL(request.url).searchParams.get("path") ?? "";

  try {
    const row = await client.query(api.dicom.getImageByPath, {
      siteSlug,
      path: relativePath,
    });
    if (row?.blobUrl) {
      const blobUrl = row.blobUrl;
      const upstream = await traceBackendPhase("external.blob", () => fetchBlob(blobUrl, {
        headers: blobRequestHeaders(request),
        signal: request.signal,
      }));
      if (upstream.ok) {
        const headers = new Headers({
          "Cache-Control": "private, no-store",
          "Content-Disposition": `inline; filename="${row.fileName}"`,
          "Content-Length": upstream.headers.get("content-length") ?? String(row.sizeBytes),
          "Content-Type": upstream.headers.get("content-type") ?? "application/dicom",
          Vary: "Host, Range",
        });
        const acceptRanges = upstream.headers.get("accept-ranges");
        if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
        const contentRange = upstream.headers.get("content-range");
        if (contentRange) headers.set("Content-Range", contentRange);
        return new Response(upstream.body, {
          status: upstream.status,
          headers,
        });
      }
    }
  } catch (error) {
    console.warn("[dicom] Blob-backed file unavailable; falling back to local file", error);
  }

  const resolved = await resolveDicomPath(relativePath);
  if (!resolved) {
    return Response.json({ error: "DICOM file not found" }, { status: 404 });
  }

  try {
    const data = await Bun.file(resolved.absolutePath).arrayBuffer();
    return new Response(data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${path.basename(resolved.absolutePath)}"`,
        "Content-Length": String(data.byteLength),
        "Content-Type": "application/dicom",
        Vary: "Host",
      },
    });
  } catch {
    return Response.json({ error: "DICOM file not readable" }, { status: 404 });
  }
}

export async function handleDiagnosticStudiesRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const studySet = new URL(request.url).searchParams.get("studySet");
  const value = await client.query(
    api.documents.getMeta,
    withSiteSlug(siteSlug, { key: diagnosticStudiesMetaKeyForSet(studySet) }),
  );
  return Response.json(
    { studies: parseDiagnosticStudiesPayload(value) },
    {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Host",
      },
    },
  );
}

export async function handleDicomComparisonsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const value = await client.query(
    api.documents.getMeta,
    withSiteSlug(siteSlug, {
      key: diagnosticComparisonsMetaKeyForSet(url.searchParams.get("studySet")),
    }),
  );
  const comparisons = parseDiagnosticComparisonsPayload(value);
  const id = dicomComparisonIdFromPath(url.pathname);

  if (id) {
    const comparison = comparisons.find((item) => item.id === id);
    if (!comparison) {
      return Response.json({ error: "Comparison not found" }, { status: 404 });
    }
    return Response.json(comparison, {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Host",
      },
    });
  }

  return Response.json(
    { comparisons },
    {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Host",
      },
    },
  );
}

export function dicomComparisonIdFromPath(pathname: string) {
  const prefix = "/api/dicom/comparisons/";
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  return raw ? decodeURIComponent(raw) : null;
}

export type AnnotationKind = "arrow" | "circle" | "box" | "text";

export type DicomAnnotation = {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  endX?: number;
  endY?: number;
  text?: string;
  color: string;
  thickness: number;
  fontSize: number;
};

export const annotationKinds = new Set<AnnotationKind>(["arrow", "circle", "box", "text"]);
export const MAX_ANNOTATIONS_PER_IMAGE = 250;

export function isFiniteUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function optionalUnitNumber(value: unknown) {
  return value === undefined || isFiniteUnitNumber(value);
}

export function validateAnnotation(value: unknown): DicomAnnotation | null {
  if (!value || typeof value !== "object") return null;
  const annotation = value as Partial<DicomAnnotation>;
  const { color, fontSize, id, kind, thickness, x, y } = annotation;
  if (typeof id !== "string" || id.length > 96) return null;
  if (!annotationKinds.has(kind as AnnotationKind)) return null;
  if (!isFiniteUnitNumber(x) || !isFiniteUnitNumber(y)) return null;
  if (!optionalUnitNumber(annotation.width) || !optionalUnitNumber(annotation.height)) return null;
  if (!optionalUnitNumber(annotation.endX) || !optionalUnitNumber(annotation.endY)) return null;
  if (!isHexColor(color)) return null;
  if (!isFinitePositiveNumber(thickness) || thickness > 32) return null;
  if (!isFinitePositiveNumber(fontSize) || fontSize > 96) return null;
  if (annotation.text !== undefined && typeof annotation.text !== "string") return null;

  return {
    id,
    kind: kind as AnnotationKind,
    x,
    y,
    ...(annotation.width !== undefined ? { width: annotation.width } : {}),
    ...(annotation.height !== undefined ? { height: annotation.height } : {}),
    ...(annotation.endX !== undefined ? { endX: annotation.endX } : {}),
    ...(annotation.endY !== undefined ? { endY: annotation.endY } : {}),
    ...(annotation.text !== undefined ? { text: annotation.text.slice(0, 400) } : {}),
    color,
    thickness,
    fontSize,
  };
}

export function validateAnnotations(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_ANNOTATIONS_PER_IMAGE) {
    return null;
  }
  const annotations = value.map(validateAnnotation);
  return annotations.every(Boolean) ? (annotations as DicomAnnotation[]) : null;
}

export async function handleDicomAnnotationsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);

  if (request.method === "GET" || request.method === "HEAD") {
    const seriesKey = url.searchParams.get("seriesKey")?.trim();
    if (!seriesKey) {
      return Response.json({ error: "seriesKey is required" }, { status: 400 });
    }

    try {
      const images = await client.query(api.imageAnnotations.listForSeries, {
        siteSlug,
        seriesKey,
      });
      return Response.json(
        { images, seriesKey },
        {
          headers: {
            "Cache-Control": "private, no-store",
            Vary: "Host",
          },
        },
      );
    } catch {
      return Response.json(
        { images: [], seriesKey, storage: "unavailable" },
        {
          headers: {
            "Cache-Control": "private, no-store",
            Vary: "Host",
          },
        },
      );
    }
  }

  if (request.method !== "PUT") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD, PUT" },
    });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        annotations?: unknown;
        imageKey?: unknown;
        imagePath?: unknown;
        seriesKey?: unknown;
      }
    | null;

  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const seriesKey = typeof body.seriesKey === "string" ? body.seriesKey.trim() : "";
  const imageKey = typeof body.imageKey === "string" ? body.imageKey.trim() : "";
  const imagePath = typeof body.imagePath === "string" ? body.imagePath.trim() : "";
  const annotations = validateAnnotations(body.annotations);

  if (!seriesKey || !imageKey || !imagePath || !annotations) {
    return Response.json({ error: "Invalid annotation payload" }, { status: 400 });
  }

  try {
    const result = await client.mutation(api.imageAnnotations.saveForImage, {
      annotations,
      imageKey,
      imagePath,
      seriesKey,
      siteSlug,
    }, { skipQueue: true });
    return Response.json(result, {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Host",
      },
    });
  } catch (error) {
    console.warn("[dicom] Annotation save unavailable", error);
    return Response.json(
      { error: "Annotation storage unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Host",
        },
      },
    );
  }
}

export async function handleTestDiagnosticStudiesRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const body = (await request.json()) as {
    studies?: unknown;
    studySet?: string;
  };
  const studySet = normalizeDiagnosticStudySet(body.studySet);
  if (!studySet) {
    return Response.json({ error: "Invalid studySet" }, { status: 400 });
  }

  const payload = normalizeDiagnosticStudiesPayload({ studies: body.studies });
  await client.mutation(
    api.documents.setMeta,
    withSiteSlug(siteSlug, {
      key: diagnosticStudiesMetaKeyForSet(studySet),
      value: JSON.stringify(payload),
    }),
    { skipQueue: true },
  );
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "Host",
    },
  });
}

export async function handleTestDicomComparisonsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const body = (await request.json()) as {
    comparisonSet?: string;
    comparisons?: unknown;
  };
  const comparisonSet = normalizeDiagnosticComparisonSet(body.comparisonSet);
  if (!comparisonSet) {
    return Response.json({ error: "Invalid comparisonSet" }, { status: 400 });
  }

  const payload = normalizeDiagnosticComparisonsPayload({
    comparisons: body.comparisons,
  });
  await client.mutation(
    api.documents.setMeta,
    withSiteSlug(siteSlug, {
      key: diagnosticComparisonsMetaKeyForSet(comparisonSet),
      value: JSON.stringify(payload),
    }),
    { skipQueue: true },
  );
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "Host",
    },
  });
}

export async function handleTimelineRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const timelineValue = await client.query(
    api.documents.getMeta,
    withSiteSlug(siteSlug, { key: TIMELINE_META_KEY }),
  );

  if (!timelineValue) {
    return Response.json(
      { error: `Diagnostic timeline not found for site '${siteSlug}'` },
      {
        status: 404,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Host",
        },
      },
    );
  }

  const diagnosticStudiesValue = await client.query(
    api.documents.getMeta,
    withSiteSlug(siteSlug, {
      key: diagnosticStudiesMetaKeyForSet(url.searchParams.get("studySet")),
    }),
  );
  const diagnosticStudies = parseDiagnosticStudiesPayload(diagnosticStudiesValue);
  const timeline = prepareDiagnosticTimelineResponse(
    timelineValue,
    diagnosticStudies,
  ) satisfies DiagnosticTimelineData;

  return Response.json(timeline, {
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Host",
    },
  });
}
