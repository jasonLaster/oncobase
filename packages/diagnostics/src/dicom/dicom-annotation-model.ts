export type AnnotationKind = "arrow" | "circle" | "box" | "text";
export type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";
export type AnnotationPanel = "draw" | null;
export type EditHandle = "move" | "start" | "end" | "nw" | "ne" | "sw" | "se";

export type DicomAnnotationImage = {
  fileName: string;
  relativePath: string;
};

export type DicomAnnotationSeries = {
  id: string;
  title: string;
  images: DicomAnnotationImage[];
};

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

export type AnnotationSeriesResponse = {
  images?: Array<{
    annotations?: DicomAnnotation[];
    imageKey?: string;
    imagePath?: string;
  }>;
};

export type Point = {
  x: number;
  y: number;
};

export type RectBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type DraftAnnotation = {
  annotation: DicomAnnotation;
  imageKey: string;
  pointerId: number;
  start: Point;
};

export type DragEdit = {
  annotation: DicomAnnotation;
  imageKey: string;
  mode: EditHandle;
  originalAnnotations: DicomAnnotation[];
  pointerId: number;
  selectedAnnotationIds: string[];
  selectionBeforeIds: string[];
  shiftKey: boolean;
  start: Point;
  wasSelected: boolean;
};

export type SelectionMarquee = {
  additive: boolean;
  current: Point;
  pointerId: number;
  start: Point;
};

export type HistoryEntry = {
  annotations: DicomAnnotation[];
  imageKey: string;
  selectedAnnotationIds: string[];
};

export type CommitOptions = {
  historyAnnotations?: DicomAnnotation[];
  historySelectionIds?: string[];
  skipHistory?: boolean;
};

export type LayerSize = {
  height: number;
  width: number;
};

export const annotationColors = [
  "#f8fafc",
  "#171717",
  "#a8b3bf",
  "#d86ef0",
  "#a83dcc",
  "#4361ee",
  "#45a6e8",
  "#f2a83b",
  "#e66012",
  "#0f9f75",
  "#4caf62",
  "#f87171",
  "#dc2626",
];

export const MIN_DRAW_DISTANCE = 0.008;
export const SELECTED_STROKE_COLOR = "#2f80ed";
export const HANDLE_FILL_COLOR = "#f8fafc";
export const HANDLE_ACTIVE_FILL_COLOR = "#bfdbfe";
export const HANDLE_STROKE_COLOR = "#2f80ed";

export function annotationKindLabel(kind: AnnotationKind | null) {
  switch (kind) {
    case "arrow":
      return "Arrow";
    case "box":
      return "Box";
    case "circle":
      return "Circle";
    case "text":
      return "Text";
    default:
      return "Draw";
  }
}
