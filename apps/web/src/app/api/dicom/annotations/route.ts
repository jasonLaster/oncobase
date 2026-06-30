import { NextRequest, NextResponse } from "next/server";

import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { siteSlugFromRequest } from "@/lib/site";

type AnnotationKind = "arrow" | "circle" | "box" | "text";

type DicomAnnotation = {
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

const annotationKinds = new Set<AnnotationKind>(["arrow", "circle", "box", "text"]);
const MAX_ANNOTATIONS_PER_IMAGE = 250;

function isFiniteUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function optionalUnitNumber(value: unknown) {
  return value === undefined || isFiniteUnitNumber(value);
}

function validateAnnotation(value: unknown): DicomAnnotation | null {
  if (!value || typeof value !== "object") return null;
  const annotation = value as Partial<DicomAnnotation>;
  const id = annotation.id;
  const kind = annotation.kind;
  const x = annotation.x;
  const y = annotation.y;
  const color = annotation.color;
  const thickness = annotation.thickness;
  const fontSize = annotation.fontSize;
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

function validateAnnotations(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_ANNOTATIONS_PER_IMAGE) {
    return null;
  }
  const annotations = value.map(validateAnnotation);
  return annotations.every(Boolean) ? (annotations as DicomAnnotation[]) : null;
}

export async function GET(request: NextRequest) {
  const siteSlug = siteSlugFromRequest(request);
  const seriesKey = request.nextUrl.searchParams.get("seriesKey")?.trim();
  if (!seriesKey) {
    return NextResponse.json({ error: "seriesKey is required" }, { status: 400 });
  }

  try {
    const images = await getConvexServerClient().query(
      api.imageAnnotations.listForSeries,
      {
        siteSlug,
        seriesKey,
      },
    );

    return NextResponse.json(
      { images, seriesKey },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { images: [], seriesKey, storage: "unavailable" },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}

export async function PUT(request: NextRequest) {
  const siteSlug = siteSlugFromRequest(request);
  const body = (await request.json().catch(() => null)) as
    | {
        annotations?: unknown;
        imageKey?: unknown;
        imagePath?: unknown;
        seriesKey?: unknown;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const seriesKey = typeof body.seriesKey === "string" ? body.seriesKey.trim() : "";
  const imageKey = typeof body.imageKey === "string" ? body.imageKey.trim() : "";
  const imagePath = typeof body.imagePath === "string" ? body.imagePath.trim() : "";
  const annotations = validateAnnotations(body.annotations);

  if (!seriesKey || !imageKey || !imagePath || !annotations) {
    return NextResponse.json({ error: "Invalid annotation payload" }, { status: 400 });
  }

  try {
    const result = await getConvexServerClient().mutation(
      api.imageAnnotations.saveForImage,
      {
        annotations,
        imageKey,
        imagePath,
        seriesKey,
        siteSlug,
      },
    );

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.warn("[dicom] Annotation save unavailable", error);
    return NextResponse.json(
      { error: "Annotation storage unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}
