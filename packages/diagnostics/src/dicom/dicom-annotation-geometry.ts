import {
  MIN_DRAW_DISTANCE,
  type AnnotationKind,
  type DicomAnnotation,
  type DragEdit,
  type EditHandle,
  type LayerSize,
  type Point,
  type RectBounds,
} from "./dicom-annotation-model.ts";

export function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampDelta(delta: number, min: number, max: number) {
  return Math.max(-min, Math.min(1 - max, delta));
}

function randomId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `annotation-${Date.now()}-${Math.random()}`
  );
}

export function drawDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

export function makeAnnotation({
  color,
  current,
  fontSize,
  kind,
  start,
  text,
  thickness,
}: {
  color: string;
  current: Point;
  fontSize: number;
  kind: AnnotationKind;
  start: Point;
  text: string;
  thickness: number;
}): DicomAnnotation {
  if (kind === "arrow") {
    return {
      id: randomId(),
      kind,
      x: start.x,
      y: start.y,
      endX: current.x,
      endY: current.y,
      color,
      thickness,
      fontSize,
    };
  }

  if (kind === "text") {
    return {
      id: randomId(),
      kind,
      x: start.x,
      y: start.y,
      width: Math.max(0.08, Math.abs(current.x - start.x)),
      height: Math.max(0.04, Math.abs(current.y - start.y)),
      text: text.trim() || "Text",
      color,
      thickness,
      fontSize,
    };
  }

  return {
    id: randomId(),
    kind,
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
    color,
    thickness,
    fontSize,
  };
}

export function replaceAnnotationId(
  annotation: DicomAnnotation,
  id: string,
): DicomAnnotation {
  return { ...annotation, id };
}

export function annotationIsDrawable(annotation: DicomAnnotation) {
  if (annotation.kind === "text") return true;
  if (annotation.kind === "arrow") {
    return (
      annotation.endX !== undefined &&
      annotation.endY !== undefined &&
      drawDistance(annotation, { x: annotation.endX, y: annotation.endY }) >=
        MIN_DRAW_DISTANCE
    );
  }
  return (
    (annotation.width ?? 0) >= MIN_DRAW_DISTANCE &&
    (annotation.height ?? 0) >= MIN_DRAW_DISTANCE
  );
}

export function svgPoint(point: Point, layerSize: LayerSize) {
  return {
    x: point.x * Math.max(1, layerSize.width),
    y: point.y * Math.max(1, layerSize.height),
  };
}

export function cssPercent(value: number) {
  return `${clampUnit(value) * 100}%`;
}

export function textBounds(
  annotation: DicomAnnotation,
  layerSize: LayerSize = { height: 1000, width: 1000 },
): RectBounds {
  const fontPixelSize = Math.max(12, annotation.fontSize);
  const fontUnitX = fontPixelSize / Math.max(1, layerSize.width);
  const fontUnitY = fontPixelSize / Math.max(1, layerSize.height);
  const textLength = Math.max(4, (annotation.text || "Text").length);
  return {
    height: Math.max(annotation.height ?? 0, fontUnitY * 1.25),
    width: Math.max(annotation.width ?? 0, textLength * fontUnitX * 0.62),
    x: annotation.x,
    y: Math.max(0, annotation.y - fontUnitY),
  };
}

export function annotationBounds(
  annotation: DicomAnnotation,
  layerSize?: LayerSize,
): { maxX: number; maxY: number; minX: number; minY: number } {
  if (annotation.kind === "arrow") {
    const endX = annotation.endX ?? annotation.x;
    const endY = annotation.endY ?? annotation.y;
    return {
      maxX: Math.max(annotation.x, endX),
      maxY: Math.max(annotation.y, endY),
      minX: Math.min(annotation.x, endX),
      minY: Math.min(annotation.y, endY),
    };
  }

  if (annotation.kind === "text") {
    const bounds = textBounds(annotation, layerSize);
    return {
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
      minX: bounds.x,
      minY: bounds.y,
    };
  }

  return {
    maxX: annotation.x + (annotation.width ?? 0),
    maxY: annotation.y + (annotation.height ?? 0),
    minX: annotation.x,
    minY: annotation.y,
  };
}

export function rectFromPoints(start: Point, current: Point): RectBounds {
  return {
    height: Math.abs(current.y - start.y),
    width: Math.abs(current.x - start.x),
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
  };
}

export function boundsIntersectRect(
  bounds: { maxX: number; maxY: number; minX: number; minY: number },
  rect: RectBounds,
) {
  return (
    bounds.maxX >= rect.x &&
    bounds.minX <= rect.x + rect.width &&
    bounds.maxY >= rect.y &&
    bounds.minY <= rect.y + rect.height
  );
}

export function annotationGroupBounds(
  annotations: DicomAnnotation[],
  layerSize?: LayerSize,
) {
  if (annotations.length === 0) return null;
  const bounds = annotations.map((annotation) =>
    annotationBounds(annotation, layerSize),
  );
  return {
    maxX: Math.max(...bounds.map((bound) => bound.maxX)),
    maxY: Math.max(...bounds.map((bound) => bound.maxY)),
    minX: Math.min(...bounds.map((bound) => bound.minX)),
    minY: Math.min(...bounds.map((bound) => bound.minY)),
  };
}

function translateAnnotation(
  annotation: DicomAnnotation,
  dx: number,
  dy: number,
) {
  if (annotation.kind === "arrow") {
    return {
      ...annotation,
      endX: clampUnit((annotation.endX ?? annotation.x) + dx),
      endY: clampUnit((annotation.endY ?? annotation.y) + dy),
      x: clampUnit(annotation.x + dx),
      y: clampUnit(annotation.y + dy),
    };
  }

  return {
    ...annotation,
    x: clampUnit(annotation.x + dx),
    y: clampUnit(annotation.y + dy),
  };
}

function moveAnnotation(annotation: DicomAnnotation, dx: number, dy: number) {
  const bounds = annotationBounds(annotation);
  const boundedDx = clampDelta(dx, bounds.minX, bounds.maxX);
  const boundedDy = clampDelta(dy, bounds.minY, bounds.maxY);

  return translateAnnotation(annotation, boundedDx, boundedDy);
}

function moveAnnotationGroup(
  annotations: DicomAnnotation[],
  selectedIds: string[],
  dx: number,
  dy: number,
  layerSize: LayerSize,
) {
  const selectedIdSet = new Set(selectedIds);
  const selectedAnnotations = annotations.filter((annotation) =>
    selectedIdSet.has(annotation.id),
  );
  const bounds = annotationGroupBounds(selectedAnnotations, layerSize);
  if (!bounds) return annotations;
  const boundedDx = clampDelta(dx, bounds.minX, bounds.maxX);
  const boundedDy = clampDelta(dy, bounds.minY, bounds.maxY);
  return annotations.map((annotation) =>
    selectedIdSet.has(annotation.id)
      ? translateAnnotation(annotation, boundedDx, boundedDy)
      : annotation,
  );
}

function resizeBoxAnnotation(
  annotation: DicomAnnotation,
  handle: Exclude<EditHandle, "move" | "start" | "end">,
  point: Point,
) {
  const left = annotation.x;
  const right = annotation.x + (annotation.width ?? 0);
  const top = annotation.y;
  const bottom = annotation.y + (annotation.height ?? 0);
  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;

  if (handle.includes("w")) nextLeft = point.x;
  if (handle.includes("e")) nextRight = point.x;
  if (handle.includes("n")) nextTop = point.y;
  if (handle.includes("s")) nextBottom = point.y;

  return {
    ...annotation,
    height: Math.abs(nextBottom - nextTop),
    width: Math.abs(nextRight - nextLeft),
    x: Math.min(nextLeft, nextRight),
    y: Math.min(nextTop, nextBottom),
  };
}

function editAnnotation(
  annotation: DicomAnnotation,
  mode: EditHandle,
  start: Point,
  current: Point,
) {
  if (mode === "move") {
    return moveAnnotation(annotation, current.x - start.x, current.y - start.y);
  }

  if (annotation.kind === "arrow") {
    if (mode === "start") {
      return { ...annotation, x: current.x, y: current.y };
    }
    if (mode === "end") {
      return { ...annotation, endX: current.x, endY: current.y };
    }
    return annotation;
  }

  if (annotation.kind === "box" || annotation.kind === "circle") {
    if (mode === "nw" || mode === "ne" || mode === "sw" || mode === "se") {
      return resizeBoxAnnotation(annotation, mode, current);
    }
  }

  return annotation;
}

export function editAnnotationsForDrag(
  dragEdit: DragEdit,
  current: Point,
  layerSize: LayerSize,
) {
  if (dragEdit.mode === "move") {
    return moveAnnotationGroup(
      dragEdit.originalAnnotations,
      dragEdit.selectedAnnotationIds,
      current.x - dragEdit.start.x,
      current.y - dragEdit.start.y,
      layerSize,
    );
  }

  const nextAnnotation = editAnnotation(
    dragEdit.annotation,
    dragEdit.mode,
    dragEdit.start,
    current,
  );
  return dragEdit.originalAnnotations.map((annotation) =>
    annotation.id === dragEdit.annotation.id ? nextAnnotation : annotation,
  );
}

export function dragSelectionAfterPointerUp(
  dragEdit: DragEdit,
  moved: boolean,
) {
  if (moved || dragEdit.mode !== "move") return dragEdit.selectedAnnotationIds;
  if (!dragEdit.shiftKey) return [dragEdit.annotation.id];
  if (dragEdit.wasSelected) {
    return dragEdit.selectionBeforeIds.filter(
      (id) => id !== dragEdit.annotation.id,
    );
  }
  return uniqueIds([...dragEdit.selectionBeforeIds, dragEdit.annotation.id]);
}
