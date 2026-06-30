"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  ChevronDown,
  Circle,
  Eraser,
  MousePointer2,
  Palette,
  PencilLine,
  Square,
  Type,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AnnotationKind = "arrow" | "circle" | "box" | "text";
type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";
type AnnotationPanel = "draw" | "style" | null;
type EditHandle = "move" | "start" | "end" | "nw" | "ne" | "sw" | "se";

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

type AnnotationSeriesResponse = {
  images?: Array<{
    annotations?: DicomAnnotation[];
    imageKey?: string;
    imagePath?: string;
  }>;
};

type Point = {
  x: number;
  y: number;
};

type RectBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type DraftAnnotation = {
  annotation: DicomAnnotation;
  imageKey: string;
  pointerId: number;
  start: Point;
};

type DragEdit = {
  annotation: DicomAnnotation;
  imageKey: string;
  mode: EditHandle;
  originalAnnotations: DicomAnnotation[];
  pointerId: number;
  start: Point;
};

type HistoryEntry = {
  annotations: DicomAnnotation[];
  imageKey: string;
  selectedAnnotationId: string | null;
};

type CommitOptions = {
  historyAnnotations?: DicomAnnotation[];
  historySelectionId?: string | null;
  skipHistory?: boolean;
};

type LayerSize = {
  height: number;
  width: number;
};

const colors = [
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
const MIN_DRAW_DISTANCE = 0.008;

const toolOptions: Array<{
  icon: ReactNode;
  kind: AnnotationKind;
  label: string;
}> = [
  { icon: <ArrowUpRight className="size-4" />, kind: "arrow", label: "Arrow" },
  { icon: <Square className="size-4" />, kind: "box", label: "Box" },
  { icon: <Circle className="size-4" />, kind: "circle", label: "Circle" },
  { icon: <Type className="size-4" />, kind: "text", label: "Text" },
];

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampDelta(delta: number, min: number, max: number) {
  return Math.max(-min, Math.min(1 - max, delta));
}

function imageKey(image: DicomAnnotationImage) {
  return image.relativePath;
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `annotation-${Date.now()}-${Math.random()}`;
}

function pointFromPointer(event: PointerEvent<SVGElement>): Point {
  const svg =
    event.currentTarget instanceof SVGSVGElement
      ? event.currentTarget
      : event.currentTarget.ownerSVGElement;
  const rect = svg?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return {
    x: clampUnit((event.clientX - rect.left) / Math.max(1, rect.width)),
    y: clampUnit((event.clientY - rect.top) / Math.max(1, rect.height)),
  };
}

function drawDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makeAnnotation({
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

function replaceAnnotationId(
  annotation: DicomAnnotation,
  id: string,
): DicomAnnotation {
  return { ...annotation, id };
}

function annotationIsDrawable(annotation: DicomAnnotation) {
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

function svgPoint(point: Point) {
  return {
    x: point.x * 1000,
    y: point.y * 1000,
  };
}

function cssPercent(value: number) {
  return `${clampUnit(value) * 100}%`;
}

function textBounds(annotation: DicomAnnotation): RectBounds {
  const fontUnit = Math.max(12, annotation.fontSize) / 1000;
  const textLength = Math.max(4, (annotation.text || "Text").length);
  return {
    height: Math.max(annotation.height ?? 0, fontUnit * 1.25),
    width: Math.max(annotation.width ?? 0, textLength * fontUnit * 0.62),
    x: annotation.x,
    y: Math.max(0, annotation.y - fontUnit),
  };
}

function annotationBounds(annotation: DicomAnnotation) {
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
    const bounds = textBounds(annotation);
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

function moveAnnotation(annotation: DicomAnnotation, dx: number, dy: number) {
  const bounds = annotationBounds(annotation);
  const boundedDx = clampDelta(dx, bounds.minX, bounds.maxX);
  const boundedDy = clampDelta(dy, bounds.minY, bounds.maxY);

  if (annotation.kind === "arrow") {
    return {
      ...annotation,
      endX: clampUnit((annotation.endX ?? annotation.x) + boundedDx),
      endY: clampUnit((annotation.endY ?? annotation.y) + boundedDy),
      x: clampUnit(annotation.x + boundedDx),
      y: clampUnit(annotation.y + boundedDy),
    };
  }

  return {
    ...annotation,
    x: clampUnit(annotation.x + boundedDx),
    y: clampUnit(annotation.y + boundedDy),
  };
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

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function loadAnnotationsMap(response: AnnotationSeriesResponse) {
  const next: Record<string, DicomAnnotation[]> = {};
  for (const image of response.images ?? []) {
    const key = image.imageKey ?? image.imagePath;
    if (!key) continue;
    next[key] = image.annotations ?? [];
  }
  return next;
}

function toolLabel(kind: AnnotationKind | null) {
  return toolOptions.find((tool) => tool.kind === kind)?.label ?? "Draw";
}

export function DicomAnnotationLayer({
  currentImage,
  disabled,
  editorPortalElement,
  onEditorOpenChange,
  series,
}: {
  currentImage: DicomAnnotationImage | null;
  disabled?: boolean;
  editorPortalElement?: HTMLElement | null;
  onEditorOpenChange?: (open: boolean) => void;
  series: DicomAnnotationSeries | null;
}) {
  const [activeTool, setActiveTool] = useState<AnnotationKind | null>(null);
  const [color, setColor] = useState("#45a6e8");
  const [thickness, setThickness] = useState(3);
  const [fontSize, setFontSize] = useState(22);
  const [text, setText] = useState("Note");
  const [annotationsByImage, setAnnotationsByImage] = useState<
    Record<string, DicomAnnotation[]>
  >({});
  const [loadedSeriesId, setLoadedSeriesId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftAnnotation | null>(null);
  const [dragEdit, setDragEdit] = useState<DragEdit | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [layerSize, setLayerSize] = useState<LayerSize>({ height: 0, width: 0 });
  const [openPanel, setOpenPanel] = useState<AnnotationPanel>(null);
  const [, setSaveStatus] = useState<SaveStatus>("idle");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(
    null,
  );
  const currentImageKey = currentImage ? imageKey(currentImage) : null;
  const seriesId = series?.id ?? null;
  const historyRef = useRef<HistoryEntry[]>([]);
  const inlineTextInputRef = useRef<HTMLInputElement | null>(null);
  const lastTextPointerDownRef = useRef<{ annotationId: string; time: number } | null>(
    null,
  );
  const layerRef = useRef<HTMLDivElement | null>(null);
  const saveTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      for (const timer of Object.values(saveTimers.current)) {
        window.clearTimeout(timer);
      }
      saveTimers.current = {};
    };
  }, []);

  useEffect(() => {
    setActiveTool(null);
    setDraft(null);
    setDragEdit(null);
    setEditingTextId(null);
    setOpenPanel(null);
    setSelectedAnnotationId(null);
    historyRef.current = [];
  }, [currentImageKey, seriesId]);

  useEffect(() => {
    const node = layerRef.current;
    if (!node) return;

    const updateLayerSize = () => {
      const rect = node.getBoundingClientRect();
      setLayerSize({ height: rect.height, width: rect.width });
    };

    updateLayerSize();
    const observer = new ResizeObserver(updateLayerSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!seriesId) return;

    async function loadSeriesAnnotations() {
      setDraft(null);
      setSaveStatus("loading");
      try {
        const response = await fetch(
          `/api/dicom/annotations?seriesKey=${encodeURIComponent(seriesId!)}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error(`annotations ${response.status}`);
        const body = (await response.json()) as AnnotationSeriesResponse;
        if (cancelled) return;
        setAnnotationsByImage(loadAnnotationsMap(body));
        setLoadedSeriesId(seriesId);
        setSaveStatus("idle");
      } catch {
        if (cancelled) return;
        setLoadedSeriesId(seriesId);
        setAnnotationsByImage({});
        setSaveStatus("error");
      }
    }

    void loadSeriesAnnotations();

    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  const annotations = useMemo(
    () =>
      currentImageKey && loadedSeriesId === seriesId
        ? (annotationsByImage[currentImageKey] ?? [])
        : [],
    [annotationsByImage, currentImageKey, loadedSeriesId, seriesId],
  );
  const selectedAnnotation =
    annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;
  const selectedAnnotationOpen = Boolean(selectedAnnotation);
  const editingTextAnnotation =
    annotations.find(
      (annotation) =>
        annotation.id === editingTextId && annotation.kind === "text",
    ) ?? null;
  const editingTextAnnotationId = editingTextAnnotation?.id ?? null;

  useEffect(() => {
    if (!selectedAnnotationId) return;
    if (!annotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [annotations, selectedAnnotationId]);

  useEffect(() => {
    if (!editingTextId) return;
    if (!annotations.some((annotation) => annotation.id === editingTextId)) {
      setEditingTextId(null);
    }
  }, [annotations, editingTextId]);

  useEffect(() => {
    onEditorOpenChange?.(selectedAnnotationOpen);
  }, [onEditorOpenChange, selectedAnnotationOpen]);

  useEffect(() => {
    return () => onEditorOpenChange?.(false);
  }, [onEditorOpenChange]);

  const saveImageAnnotations = useCallback(
    (image: DicomAnnotationImage, nextAnnotations: DicomAnnotation[]) => {
      if (!series) return;
      const key = imageKey(image);
      setLoadedSeriesId(series.id);
      if (saveTimers.current[key]) {
        window.clearTimeout(saveTimers.current[key]);
      }
      setSaveStatus("saving");
      saveTimers.current[key] = window.setTimeout(() => {
        fetch("/api/dicom/annotations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            annotations: nextAnnotations,
            imageKey: key,
            imagePath: image.relativePath,
            seriesKey: series.id,
          }),
        })
          .then((response) => {
            if (!response.ok) throw new Error(`save ${response.status}`);
            setSaveStatus("saved");
          })
          .catch(() => setSaveStatus("error"));
      }, 250);
    },
    [series],
  );

  const commitAnnotations = useCallback(
    (
      image: DicomAnnotationImage,
      nextAnnotations: DicomAnnotation[],
      options: CommitOptions = {},
    ) => {
      const key = imageKey(image);
      if (!options.skipHistory) {
        historyRef.current = [
          ...historyRef.current,
          {
            annotations:
              options.historyAnnotations ?? annotationsByImage[key] ?? [],
            imageKey: key,
            selectedAnnotationId:
              options.historySelectionId === undefined
                ? selectedAnnotationId
                : options.historySelectionId,
          },
        ].slice(-80);
      }
      setAnnotationsByImage((current) => ({
        ...current,
        [key]: nextAnnotations,
      }));
      saveImageAnnotations(image, nextAnnotations);
    },
    [annotationsByImage, saveImageAnnotations, selectedAnnotationId],
  );

  const updateSelectedAnnotation = useCallback(
    (patch: Partial<DicomAnnotation>) => {
      if (!currentImage || !currentImageKey || !selectedAnnotationId) return;
      const currentAnnotations = annotationsByImage[currentImageKey] ?? [];
      if (!currentAnnotations.some((annotation) => annotation.id === selectedAnnotationId)) {
        return;
      }
      commitAnnotations(
        currentImage,
        currentAnnotations.map((annotation) =>
          annotation.id === selectedAnnotationId
            ? { ...annotation, ...patch }
            : annotation,
        ),
      );
    },
    [
      annotationsByImage,
      commitAnnotations,
      currentImage,
      currentImageKey,
      selectedAnnotationId,
    ],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (!activeTool) {
        if (editMode) setSelectedAnnotationId(null);
        setEditingTextId(null);
        setOpenPanel(null);
        return;
      }
      if (disabled || !currentImage || !currentImageKey) return;
      const start = pointFromPointer(event);
      const annotation = makeAnnotation({
        color,
        current: start,
        fontSize,
        kind: activeTool,
        start,
        text,
        thickness,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      setDraft({
        annotation,
        imageKey: currentImageKey,
        pointerId: event.pointerId,
        start,
      });
    },
    [
      activeTool,
      color,
      currentImage,
      currentImageKey,
      disabled,
      editMode,
      fontSize,
      text,
      thickness,
    ],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (dragEdit) {
        if (dragEdit.pointerId !== event.pointerId) return;
        const current = pointFromPointer(event);
        const nextAnnotation = editAnnotation(
          dragEdit.annotation,
          dragEdit.mode,
          dragEdit.start,
          current,
        );
        setAnnotationsByImage((currentByImage) => ({
          ...currentByImage,
          [dragEdit.imageKey]: (currentByImage[dragEdit.imageKey] ?? []).map(
            (annotation) =>
              annotation.id === dragEdit.annotation.id ? nextAnnotation : annotation,
          ),
        }));
        return;
      }

      if (!draft || !activeTool) return;
      const current = pointFromPointer(event);
      const next = replaceAnnotationId(
        makeAnnotation({
          color,
          current,
          fontSize,
          kind: draft.annotation.kind,
          start: draft.start,
          text,
          thickness,
        }),
        draft.annotation.id,
      );
      setDraft({ ...draft, annotation: next });
    },
    [activeTool, color, draft, dragEdit, fontSize, text, thickness],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (dragEdit) {
        if (dragEdit.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const current = pointFromPointer(event);
        const nextAnnotation = editAnnotation(
          dragEdit.annotation,
          dragEdit.mode,
          dragEdit.start,
          current,
        );
        const nextAnnotations = (annotationsByImage[dragEdit.imageKey] ?? []).map(
          (annotation) =>
            annotation.id === dragEdit.annotation.id ? nextAnnotation : annotation,
        );
        if (currentImage && imageKey(currentImage) === dragEdit.imageKey) {
          commitAnnotations(currentImage, nextAnnotations, {
            historyAnnotations: dragEdit.originalAnnotations,
            historySelectionId: dragEdit.annotation.id,
          });
        }
        setDragEdit(null);
        return;
      }

      if (!draft || !currentImage || draft.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDraft(null);
      if (!annotationIsDrawable(draft.annotation)) return;

      const key = imageKey(currentImage);
      const nextAnnotations = [...(annotationsByImage[key] ?? []), draft.annotation];
      commitAnnotations(currentImage, nextAnnotations);
      setActiveTool(null);
      setEditMode(true);
      setSelectedAnnotationId(draft.annotation.id);
      if (draft.annotation.kind === "text") {
        setEditingTextId(draft.annotation.id);
        setOpenPanel(null);
      }
    },
    [annotationsByImage, commitAnnotations, currentImage, dragEdit, draft],
  );

  const startEditDrag = useCallback(
    (
      event: PointerEvent<SVGElement>,
      annotation: DicomAnnotation,
      mode: EditHandle,
    ) => {
      if (disabled || !currentImageKey) return;
      if (annotation.kind === "text" && mode === "move") {
        const now = performance.now();
        const last = lastTextPointerDownRef.current;
        if (
          event.detail >= 2 ||
          (last?.annotationId === annotation.id && now - last.time < 420)
        ) {
          lastTextPointerDownRef.current = null;
          event.preventDefault();
          event.stopPropagation();
          setActiveTool(null);
          setEditMode(true);
          setOpenPanel(null);
          setEditingTextId(annotation.id);
          setSelectedAnnotationId(annotation.id);
          return;
        }
        lastTextPointerDownRef.current = { annotationId: annotation.id, time: now };
      }
      const svg = event.currentTarget.ownerSVGElement;
      svg?.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      const pointer = pointFromPointer(event);
      const originalAnnotations = annotationsByImage[currentImageKey] ?? [];
      setActiveTool(null);
      setEditMode(true);
      setOpenPanel(null);
      setEditingTextId(null);
      setSelectedAnnotationId(annotation.id);
      setDragEdit({
        annotation,
        imageKey: currentImageKey,
        mode,
        originalAnnotations,
        pointerId: event.pointerId,
        start: pointer,
      });
    },
    [annotationsByImage, currentImageKey, disabled],
  );

  const undoLast = useCallback(() => {
    if (!currentImage) return;
    const key = imageKey(currentImage);
    const historyIndex = historyRef.current.findLastIndex(
      (entry) => entry.imageKey === key,
    );
    if (historyIndex < 0) return;

    const entry = historyRef.current[historyIndex];
    historyRef.current = historyRef.current.filter(
      (_, index) => index !== historyIndex,
    );
    setSelectedAnnotationId(
      entry.selectedAnnotationId &&
        entry.annotations.some(
          (annotation) => annotation.id === entry.selectedAnnotationId,
        )
        ? entry.selectedAnnotationId
        : null,
    );
    commitAnnotations(currentImage, entry.annotations, { skipHistory: true });
  }, [commitAnnotations, currentImage]);

  const clearCurrent = useCallback(() => {
    if (!currentImage) return;
    setSelectedAnnotationId(null);
    commitAnnotations(currentImage, []);
  }, [commitAnnotations, currentImage]);

  const deleteSelected = useCallback(() => {
    if (!currentImage || !currentImageKey || !selectedAnnotationId) return;
    const nextAnnotations = (annotationsByImage[currentImageKey] ?? []).filter(
      (annotation) => annotation.id !== selectedAnnotationId,
    );
    setSelectedAnnotationId(null);
    commitAnnotations(currentImage, nextAnnotations);
  }, [
    annotationsByImage,
    commitAnnotations,
    currentImage,
    currentImageKey,
    selectedAnnotationId,
  ]);

  useEffect(() => {
    if (disabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTextInputTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && key === "z") {
        event.preventDefault();
        undoLast();
        return;
      }

      if (
        selectedAnnotationId &&
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key === "Backspace" || event.key === "Delete")
      ) {
        event.preventDefault();
        deleteSelected();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, disabled, selectedAnnotationId, undoLast]);

  const chooseTool = useCallback((kind: AnnotationKind) => {
    setActiveTool(kind);
    setEditMode(false);
    setEditingTextId(null);
    setOpenPanel(null);
    setSelectedAnnotationId(null);
  }, []);

  const chooseColor = useCallback(
    (nextColor: string) => {
      setColor(nextColor);
      updateSelectedAnnotation({ color: nextColor });
    },
    [updateSelectedAnnotation],
  );

  const chooseThickness = useCallback(
    (nextThickness: number) => {
      setThickness(nextThickness);
      updateSelectedAnnotation({ thickness: nextThickness });
    },
    [updateSelectedAnnotation],
  );

  const chooseFontSize = useCallback(
    (nextFontSize: number) => {
      setFontSize(nextFontSize);
      updateSelectedAnnotation({ fontSize: nextFontSize });
    },
    [updateSelectedAnnotation],
  );

  const chooseText = useCallback(
    (nextText: string) => {
      setText(nextText);
      if (selectedAnnotation?.kind === "text") {
        updateSelectedAnnotation({ text: nextText });
      }
    },
    [selectedAnnotation?.kind, updateSelectedAnnotation],
  );

  const editTextAnnotation = useCallback((annotation: DicomAnnotation) => {
    setActiveTool(null);
    setEditMode(true);
    setOpenPanel(null);
    setEditingTextId(annotation.id);
    setSelectedAnnotationId(annotation.id);
  }, []);

  useEffect(() => {
    if (!editingTextAnnotationId) return;
    const timer = window.setTimeout(() => {
      inlineTextInputRef.current?.focus();
      inlineTextInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editingTextAnnotationId]);

  const visibleAnnotations =
    draft && draft.imageKey === currentImageKey
      ? [...annotations, draft.annotation]
      : annotations;
  const canvasInteractive = !disabled && Boolean(activeTool || editMode || dragEdit);
  const activeColor = selectedAnnotation?.color ?? color;
  const activeThickness = selectedAnnotation?.thickness ?? thickness;
  const activeFontSize = selectedAnnotation?.fontSize ?? fontSize;
  const activeText = selectedAnnotation?.kind === "text" ? selectedAnnotation.text || "" : text;
  const editingBounds = editingTextAnnotation
    ? textBounds(editingTextAnnotation)
    : null;
  const inlineFontSize =
    editingTextAnnotation && layerSize.height > 0
      ? Math.max(12, (editingTextAnnotation.fontSize / 1000) * layerSize.height)
      : undefined;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      data-test-id="dicom-annotation-layer"
      ref={layerRef}
    >
      <svg
        aria-label="DICOM annotation canvas"
        className={cn(
          "absolute inset-0 h-full w-full touch-none",
          canvasInteractive
            ? activeTool
              ? "pointer-events-auto cursor-crosshair"
              : "pointer-events-auto cursor-default"
            : "pointer-events-none",
        )}
        data-test-id="dicom-annotation-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        viewBox="0 0 1000 1000"
      >
        {visibleAnnotations.map((annotation) => (
          <AnnotationShape
            annotation={annotation}
            editable={editMode && !activeTool && !disabled}
            key={annotation.id}
            onStartEditDrag={startEditDrag}
            onTextEdit={editTextAnnotation}
            selected={annotation.id === selectedAnnotationId}
          />
        ))}
      </svg>

      <div
        className="pointer-events-auto absolute top-3 left-3 z-20 w-fit max-w-[calc(100%-1.5rem)]"
        data-test-id="dicom-annotation-toolbar"
      >
        <div className="flex items-center gap-1 rounded-md border border-white/15 bg-black/80 p-1 shadow-lg backdrop-blur">
          <AnnotationToolbarButton
            active={editMode && !activeTool}
            compact
            disabled={disabled}
            icon={<MousePointer2 className="size-4" />}
            label="Select"
            onClick={() => {
              setActiveTool(null);
              setEditMode((current) => !current);
              setOpenPanel(null);
            }}
          />

          <AnnotationToolbarButton
            active={Boolean(activeTool) || openPanel === "draw"}
            compact
            disabled={disabled}
            icon={<PencilLine className="size-4" />}
            label={activeTool ? toolLabel(activeTool) : "Draw"}
            onClick={() =>
              setOpenPanel((current) => (current === "draw" ? null : "draw"))
            }
          >
            <ChevronDown className="size-3.5" />
          </AnnotationToolbarButton>

          <AnnotationToolbarButton
            active={openPanel === "style"}
            compact
            disabled={disabled}
            icon={<Palette className="size-4" />}
            label="Style"
            onClick={() =>
              setOpenPanel((current) => (current === "style" ? null : "style"))
            }
          />

          <div className="mx-0.5 h-6 w-px bg-white/15" />

          <AnnotationToolbarButton
            compact
            disabled={disabled || annotations.length === 0}
            icon={<Eraser className="size-4" />}
            label="Clear"
            onClick={clearCurrent}
          />
        </div>

        {openPanel === "draw" ? (
          <AnnotationPanelFrame testId="dicom-annotation-draw-panel">
            <div className="grid gap-1">
              {toolOptions.map((tool) => (
                <button
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-zinc-200 hover:bg-white/10",
                    activeTool === tool.kind && "bg-sky-300/20 text-sky-50",
                  )}
                  data-test-id={`dicom-annotation-draw-${tool.kind}`}
                  disabled={disabled}
                  key={tool.kind}
                  onClick={() => chooseTool(tool.kind)}
                  type="button"
                >
                  {tool.icon}
                  <span>{tool.label}</span>
                </button>
              ))}
            </div>
          </AnnotationPanelFrame>
        ) : null}

        {openPanel === "style" && !selectedAnnotation ? (
          <AnnotationPanelFrame testId="dicom-annotation-style-panel">
            <AnnotationStyleControls
              activeColor={activeColor}
              activeFontSize={activeFontSize}
              activeThickness={activeThickness}
              disabled={disabled}
              onChooseColor={chooseColor}
              onChooseFontSize={chooseFontSize}
              onChooseThickness={chooseThickness}
              rail={false}
              showFontSize
            />
          </AnnotationPanelFrame>
        ) : null}
      </div>

      {selectedAnnotation && editorPortalElement
        ? createPortal(
            <AnnotationEditorRail
              activeColor={activeColor}
              activeFontSize={activeFontSize}
              activeText={activeText}
              activeThickness={activeThickness}
              disabled={disabled}
              kind={selectedAnnotation.kind}
              onChooseColor={chooseColor}
              onChooseFontSize={chooseFontSize}
              onChooseText={chooseText}
              onChooseThickness={chooseThickness}
            />,
            editorPortalElement,
          )
        : null}

      {editingTextAnnotation && editingBounds ? (
        <input
          aria-label="Edit annotation text"
          className="pointer-events-auto absolute z-40 min-w-28 rounded border border-sky-300/70 bg-black/75 px-1.5 py-0.5 font-bold text-zinc-100 shadow-lg outline-none backdrop-blur placeholder:text-zinc-500"
          data-test-id="dicom-annotation-inline-text"
          disabled={disabled}
          onBlur={() => setEditingTextId(null)}
          onChange={(event) => chooseText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditingTextId(null);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              setEditingTextId(null);
            }
          }}
          ref={inlineTextInputRef}
          style={{
            color: editingTextAnnotation.color,
            fontSize: inlineFontSize ? `${inlineFontSize}px` : undefined,
            height: inlineFontSize ? `${inlineFontSize * 1.65}px` : undefined,
            left: cssPercent(editingBounds.x),
            top: cssPercent(editingBounds.y),
            width: cssPercent(Math.max(0.12, editingBounds.width)),
          }}
          value={editingTextAnnotation.text ?? ""}
        />
      ) : null}
    </div>
  );
}

function AnnotationToolbarButton({
  active,
  children,
  compact,
  disabled,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  children?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-pressed={active}
      className={cn(
        "h-8 rounded-md border-white/15 bg-white/5 text-xs text-zinc-300 hover:bg-white/10",
        compact ? (children ? "w-10 px-0" : "w-8 px-0") : "gap-1 px-2",
        active && "border-sky-300/60 bg-sky-300/20 text-sky-50",
      )}
      data-test-id={`dicom-annotation-tool-${label.toLowerCase()}`}
      disabled={disabled}
      onClick={onClick}
      size={compact ? "icon-sm" : "sm"}
      title={label}
      type="button"
      variant="outline"
    >
      {icon}
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="max-w-16 truncate">{label}</span>
      )}
      {children}
    </Button>
  );
}

function AnnotationPanelFrame({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      className="mt-2 w-64 rounded-md border border-white/15 bg-black/85 p-2 shadow-xl backdrop-blur"
      data-test-id={testId}
    >
      {children}
    </div>
  );
}

function AnnotationEditorRail({
  activeColor,
  activeFontSize,
  activeText,
  activeThickness,
  disabled,
  kind,
  onChooseColor,
  onChooseFontSize,
  onChooseText,
  onChooseThickness,
}: {
  activeColor: string;
  activeFontSize: number;
  activeText: string;
  activeThickness: number;
  disabled?: boolean;
  kind: AnnotationKind;
  onChooseColor: (color: string) => void;
  onChooseFontSize: (fontSize: number) => void;
  onChooseText: (text: string) => void;
  onChooseThickness: (thickness: number) => void;
}) {
  const label = toolLabel(kind);
  return (
    <div className="space-y-5" data-test-id="dicom-annotation-style-panel">
      <section>
        <div className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">
          Annotation
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm text-zinc-100">
          <span
            className="size-3 rounded-full border border-white/20"
            style={{ backgroundColor: activeColor }}
          />
          <span>{label}</span>
        </div>
      </section>

      <AnnotationStyleControls
        activeColor={activeColor}
        activeFontSize={activeFontSize}
        activeThickness={activeThickness}
        disabled={disabled}
        onChooseColor={onChooseColor}
        onChooseFontSize={onChooseFontSize}
        onChooseThickness={onChooseThickness}
        rail
        showFontSize={kind === "text"}
      />

      {kind === "text" ? (
        <label className="grid gap-2 text-xs text-zinc-300">
          <span className="font-medium">Text</span>
          <input
            aria-label="Annotation text"
            className="h-9 rounded-md border border-white/15 bg-black/35 px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-sky-300/70"
            data-test-id="dicom-annotation-text"
            disabled={disabled}
            onChange={(event) => onChooseText(event.currentTarget.value)}
            value={activeText}
          />
        </label>
      ) : null}
    </div>
  );
}

function AnnotationStyleControls({
  activeColor,
  activeFontSize,
  activeThickness,
  disabled,
  onChooseColor,
  onChooseFontSize,
  onChooseThickness,
  rail,
  showFontSize,
}: {
  activeColor: string;
  activeFontSize: number;
  activeThickness: number;
  disabled?: boolean;
  onChooseColor: (color: string) => void;
  onChooseFontSize: (fontSize: number) => void;
  onChooseThickness: (thickness: number) => void;
  rail: boolean;
  showFontSize: boolean;
}) {
  return (
    <div className={cn(rail ? "space-y-5" : "grid gap-2")}>
      <div
        className={cn(rail ? "grid grid-cols-4 gap-3" : "flex flex-wrap gap-1")}
        aria-label="Annotation colors"
      >
        {colors.map((candidate) => (
          <button
            aria-label={`Color ${candidate}`}
            className={cn(
              rail
                ? "size-10 rounded-xl border border-white/10 bg-white/[0.04] p-1.5"
                : "size-6 rounded border border-white/20",
              candidate === activeColor &&
                (rail
                  ? "bg-white/15 ring-2 ring-sky-300/80"
                  : "ring-2 ring-white/75 ring-offset-1 ring-offset-black"),
            )}
            data-test-id={`dicom-annotation-color-${candidate.slice(1)}`}
            disabled={disabled}
            key={candidate}
            onClick={() => onChooseColor(candidate)}
            type="button"
          >
            <span
              className="block size-full rounded-full border border-black/20"
              style={{ backgroundColor: candidate }}
            />
          </button>
        ))}
      </div>

      <label className={cn("grid gap-2", rail ? "text-xs text-zinc-300" : "")}>
        {rail ? <span className="font-medium">Thickness</span> : null}
        <input
          aria-label="Annotation thickness"
          className="w-full accent-sky-300"
          data-test-id="dicom-annotation-thickness"
          disabled={disabled}
          max={12}
          min={1}
          onChange={(event) => onChooseThickness(Number(event.currentTarget.value))}
          title="Thickness"
          type="range"
          value={activeThickness}
        />
      </label>

      {showFontSize ? (
        <label className={cn("grid gap-2", rail ? "text-xs text-zinc-300" : "")}>
          {rail ? <span className="font-medium">Font size</span> : null}
          <input
            aria-label="Annotation font size"
            className="w-full accent-sky-300"
            data-test-id="dicom-annotation-font-size"
            disabled={disabled}
            max={48}
            min={12}
            onChange={(event) => onChooseFontSize(Number(event.currentTarget.value))}
            title="Font size"
            type="range"
            value={activeFontSize}
          />
        </label>
      ) : null}
    </div>
  );
}

function arrowVisualGeometry(annotation: DicomAnnotation) {
  const start = svgPoint(annotation);
  const end = svgPoint({
    x: annotation.endX ?? annotation.x,
    y: annotation.endY ?? annotation.y,
  });
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length < 1) {
    return {
      end,
      lineEnd: end,
      points: `${end.x},${end.y}`,
    };
  }

  const unitX = dx / length;
  const unitY = dy / length;
  const headLength = Math.min(Math.max(18, annotation.thickness * 4 + 10), length * 0.55);
  const headWidth = Math.max(14, annotation.thickness * 3 + 8);
  const base = {
    x: end.x - unitX * headLength,
    y: end.y - unitY * headLength,
  };
  const perp = {
    x: -unitY * (headWidth / 2),
    y: unitX * (headWidth / 2),
  };

  return {
    end,
    lineEnd: length > headLength ? base : end,
    points: [
      `${end.x},${end.y}`,
      `${base.x + perp.x},${base.y + perp.y}`,
      `${base.x - perp.x},${base.y - perp.y}`,
    ].join(" "),
  };
}

function AnnotationShape({
  annotation,
  editable,
  onStartEditDrag,
  onTextEdit,
  selected,
}: {
  annotation: DicomAnnotation;
  editable: boolean;
  onStartEditDrag: (
    event: PointerEvent<SVGElement>,
    annotation: DicomAnnotation,
    mode: EditHandle,
  ) => void;
  onTextEdit: (annotation: DicomAnnotation) => void;
  selected: boolean;
}) {
  const start = svgPoint(annotation);
  const strokeWidth = annotation.thickness;
  const handle = (mode: EditHandle, point: Point) => (
    <AnnotationHandle
      key={mode}
      mode={mode}
      onPointerDown={(event) => onStartEditDrag(event, annotation, mode)}
      point={point}
    />
  );

  if (annotation.kind === "arrow") {
    const end = {
      x: annotation.endX ?? annotation.x,
      y: annotation.endY ?? annotation.y,
    };
    const arrow = arrowVisualGeometry(annotation);
    return (
      <g>
        {selected ? (
          <>
            <line
              data-test-id="dicom-annotation-selection"
              pointerEvents="none"
              stroke={annotation.color}
              strokeLinecap="round"
              strokeOpacity={0.36}
              strokeWidth={Math.max(8, strokeWidth + 8)}
              vectorEffect="non-scaling-stroke"
              x1={start.x}
              x2={arrow.lineEnd.x}
              y1={start.y}
              y2={arrow.lineEnd.y}
            />
            <polygon
              fill={annotation.color}
              opacity={0.36}
              pointerEvents="none"
              points={arrow.points}
            />
          </>
        ) : null}
        <line
          data-test-id="dicom-annotation-shape-arrow"
          stroke={annotation.color}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          x1={start.x}
          x2={arrow.lineEnd.x}
          y1={start.y}
          y2={arrow.lineEnd.y}
        />
        <polygon fill={annotation.color} points={arrow.points} />
        {editable ? (
          <line
            cursor="move"
            data-test-id="dicom-annotation-hit-target"
            onPointerDown={(event) => onStartEditDrag(event, annotation, "move")}
            pointerEvents="stroke"
            stroke="transparent"
            strokeLinecap="round"
            strokeWidth={Math.max(16, strokeWidth + 12)}
            vectorEffect="non-scaling-stroke"
            x1={start.x}
            x2={arrow.end.x}
            y1={start.y}
            y2={arrow.end.y}
          />
        ) : null}
        {selected && editable
          ? [
              handle("start", annotation),
              handle("end", end),
            ]
          : null}
      </g>
    );
  }

  if (annotation.kind === "circle") {
    const bounds = {
      height: annotation.height ?? 0,
      width: annotation.width ?? 0,
      x: annotation.x,
      y: annotation.y,
    };
    return (
      <g>
        <ellipse
          cx={(bounds.x + bounds.width / 2) * 1000}
          cy={(bounds.y + bounds.height / 2) * 1000}
          data-test-id="dicom-annotation-shape-circle"
          fill="transparent"
          rx={(bounds.width * 1000) / 2}
          ry={(bounds.height * 1000) / 2}
          stroke={annotation.color}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
        {editable ? (
          <ellipse
            cursor="move"
            fill="transparent"
            onPointerDown={(event) => onStartEditDrag(event, annotation, "move")}
            pointerEvents="all"
            rx={(bounds.width * 1000) / 2}
            ry={(bounds.height * 1000) / 2}
            stroke="transparent"
            strokeWidth={Math.max(16, strokeWidth + 12)}
            vectorEffect="non-scaling-stroke"
            cx={(bounds.x + bounds.width / 2) * 1000}
            cy={(bounds.y + bounds.height / 2) * 1000}
          />
        ) : null}
        {selected ? (
          <rect
            data-test-id="dicom-annotation-selection"
            fill="transparent"
            height={bounds.height * 1000}
            pointerEvents="none"
            stroke={annotation.color}
            strokeOpacity={0.42}
            strokeWidth={Math.max(3, strokeWidth + 4)}
            vectorEffect="non-scaling-stroke"
            width={bounds.width * 1000}
            x={bounds.x * 1000}
            y={bounds.y * 1000}
          />
        ) : null}
        {selected && editable
          ? cornerHandles(bounds, handle)
          : null}
      </g>
    );
  }

  if (annotation.kind === "text") {
    const bounds = textBounds(annotation);
    return (
      <g>
        <text
          data-test-id="dicom-annotation-shape-text"
          fill={annotation.color}
          fontSize={annotation.fontSize}
          fontWeight={700}
          onClick={(event) => {
            if (event.detail >= 2) {
              event.stopPropagation();
              onTextEdit(annotation);
            }
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onTextEdit(annotation);
          }}
          paintOrder="stroke"
          stroke="rgba(0,0,0,0.72)"
          strokeWidth={Math.max(2, annotation.thickness)}
          vectorEffect="non-scaling-stroke"
          x={start.x}
          y={start.y}
        >
          {annotation.text || "Text"}
        </text>
        {editable ? (
          <rect
            cursor="move"
            data-test-id="dicom-annotation-text-hit-target"
            fill="transparent"
            height={bounds.height * 1000}
            onClick={(event) => {
              if (event.detail >= 2) {
                event.stopPropagation();
                onTextEdit(annotation);
              }
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onTextEdit(annotation);
            }}
            onPointerDown={(event) => onStartEditDrag(event, annotation, "move")}
            pointerEvents="all"
            stroke="transparent"
            width={bounds.width * 1000}
            x={bounds.x * 1000}
            y={bounds.y * 1000}
          />
        ) : null}
        {selected ? (
          <rect
            data-test-id="dicom-annotation-selection"
            fill="transparent"
            height={bounds.height * 1000}
            pointerEvents="none"
            stroke={annotation.color}
            strokeOpacity={0.42}
            strokeWidth={Math.max(3, annotation.thickness + 4)}
            vectorEffect="non-scaling-stroke"
            width={bounds.width * 1000}
            x={bounds.x * 1000}
            y={bounds.y * 1000}
          />
        ) : null}
        {selected && editable ? handle("move", annotation) : null}
      </g>
    );
  }

  const bounds = {
    height: annotation.height ?? 0,
    width: annotation.width ?? 0,
    x: annotation.x,
    y: annotation.y,
  };
  return (
    <g>
      <rect
        data-test-id="dicom-annotation-shape-box"
        fill="transparent"
        height={bounds.height * 1000}
        stroke={annotation.color}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        width={bounds.width * 1000}
        x={bounds.x * 1000}
        y={bounds.y * 1000}
      />
      {editable ? (
        <rect
          cursor="move"
          fill="transparent"
          height={bounds.height * 1000}
          onPointerDown={(event) => onStartEditDrag(event, annotation, "move")}
          pointerEvents="all"
          stroke="transparent"
          strokeWidth={Math.max(16, strokeWidth + 12)}
          vectorEffect="non-scaling-stroke"
          width={bounds.width * 1000}
          x={bounds.x * 1000}
          y={bounds.y * 1000}
        />
      ) : null}
      {selected ? (
        <rect
          data-test-id="dicom-annotation-selection"
          fill="transparent"
          height={bounds.height * 1000}
          pointerEvents="none"
          stroke={annotation.color}
          strokeOpacity={0.42}
          strokeWidth={Math.max(3, strokeWidth + 4)}
          vectorEffect="non-scaling-stroke"
          width={bounds.width * 1000}
          x={bounds.x * 1000}
          y={bounds.y * 1000}
        />
      ) : null}
      {selected && editable
        ? cornerHandles(bounds, handle)
        : null}
    </g>
  );
}

function cornerHandles(
  bounds: RectBounds,
  render: (mode: EditHandle, point: Point) => ReactNode,
) {
  return [
    render("nw", { x: bounds.x, y: bounds.y }),
    render("ne", { x: bounds.x + bounds.width, y: bounds.y }),
    render("sw", { x: bounds.x, y: bounds.y + bounds.height }),
    render("se", {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    }),
  ];
}

function AnnotationHandle({
  mode,
  onPointerDown,
  point,
}: {
  mode: EditHandle;
  onPointerDown: (event: PointerEvent<SVGCircleElement>) => void;
  point: Point;
}) {
  const handlePoint = svgPoint(point);
  return (
    <circle
      className="cursor-grab"
      cx={handlePoint.x}
      cy={handlePoint.y}
      data-test-id={`dicom-annotation-handle-${mode}`}
      fill="#38bdf8"
      onPointerDown={onPointerDown}
      r={7}
      stroke="rgba(2,6,23,0.75)"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}
