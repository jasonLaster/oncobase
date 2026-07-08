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
  MousePointer2,
  PencilLine,
  Square,
  Type,
} from "lucide-react";

import { cn } from "./ui.tsx";

import {
  AnnotationEditorRail,
  AnnotationPanelFrame,
  AnnotationSelectionRail,
  AnnotationToolbarButton,
} from "./dicom-annotation-controls.tsx";
import { imageKey, loadAnnotationsMap } from "./dicom-annotation-data.ts";
import {
  annotationBounds,
  annotationGroupBounds,
  annotationIsDrawable,
  boundsIntersectRect,
  cssPercent,
  dragSelectionAfterPointerUp,
  drawDistance,
  editAnnotationsForDrag,
  makeAnnotation,
  rectFromPoints,
  replaceAnnotationId,
  textBounds,
  uniqueIds,
} from "./dicom-annotation-geometry.ts";
import {
  isTextInputTarget,
  pointFromSvgPointer,
} from "./dicom-annotation-interaction.ts";
import {
  MIN_DRAW_DISTANCE,
  SELECTED_STROKE_COLOR,
  annotationKindLabel,
  type AnnotationKind,
  type AnnotationPanel,
  type AnnotationSeriesResponse,
  type CommitOptions,
  type DicomAnnotation,
  type DicomAnnotationImage,
  type DicomAnnotationSeries,
  type DraftAnnotation,
  type DragEdit,
  type EditHandle,
  type HistoryEntry,
  type LayerSize,
  type SaveStatus,
  type SelectionMarquee,
} from "./dicom-annotation-model.ts";
import { AnnotationShape } from "./dicom-annotation-shapes.tsx";

export type {
  DicomAnnotation,
  DicomAnnotationImage,
  DicomAnnotationSeries,
} from "./dicom-annotation-model.ts";

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
  const [selectionMarquee, setSelectionMarquee] =
    useState<SelectionMarquee | null>(null);
  const [, setSaveStatus] = useState<SaveStatus>("idle");
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
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
    setSelectedAnnotationIds([]);
    setSelectionMarquee(null);
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
  const selectedIdSet = useMemo(
    () => new Set(selectedAnnotationIds),
    [selectedAnnotationIds],
  );
  const selectedAnnotations = useMemo(
    () =>
      selectedAnnotationIds
        .map((id) => annotations.find((annotation) => annotation.id === id))
        .filter((annotation): annotation is DicomAnnotation => Boolean(annotation)),
    [annotations, selectedAnnotationIds],
  );
  const primarySelectedAnnotation = selectedAnnotations.at(-1) ?? null;
  const selectedAnnotation =
    selectedAnnotations.length === 1 ? primarySelectedAnnotation : null;
  const selectedAnnotationOpen = selectedAnnotations.length > 0;
  const editingTextAnnotation =
    annotations.find(
      (annotation) =>
        annotation.id === editingTextId && annotation.kind === "text",
    ) ?? null;
  const editingTextAnnotationId = editingTextAnnotation?.id ?? null;

  useEffect(() => {
    if (selectedAnnotationIds.length === 0) return;
    const annotationIds = new Set(annotations.map((annotation) => annotation.id));
    const nextSelectedIds = selectedAnnotationIds.filter((id) =>
      annotationIds.has(id),
    );
    if (nextSelectedIds.length !== selectedAnnotationIds.length) {
      setSelectedAnnotationIds(nextSelectedIds);
    }
  }, [annotations, selectedAnnotationIds]);

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
            selectedAnnotationIds:
              options.historySelectionIds === undefined
                ? selectedAnnotationIds
                : options.historySelectionIds,
          },
        ].slice(-80);
      }
      setAnnotationsByImage((current) => ({
        ...current,
        [key]: nextAnnotations,
      }));
      saveImageAnnotations(image, nextAnnotations);
    },
    [annotationsByImage, saveImageAnnotations, selectedAnnotationIds],
  );

  const updateSelectedAnnotation = useCallback(
    (patch: Partial<DicomAnnotation>) => {
      if (!currentImage || !currentImageKey || selectedAnnotationIds.length === 0) {
        return;
      }
      const currentAnnotations = annotationsByImage[currentImageKey] ?? [];
      const selectedIds = new Set(selectedAnnotationIds);
      if (!currentAnnotations.some((annotation) => selectedIds.has(annotation.id))) {
        return;
      }
      commitAnnotations(
        currentImage,
        currentAnnotations.map((annotation) =>
          selectedIds.has(annotation.id)
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
      selectedAnnotationIds,
    ],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (!activeTool) {
        if (editMode && !disabled && currentImageKey) {
          const start = pointFromSvgPointer(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          setSelectionMarquee({
            additive: event.shiftKey,
            current: start,
            pointerId: event.pointerId,
            start,
          });
        }
        setEditingTextId(null);
        setOpenPanel(null);
        return;
      }
      if (disabled || !currentImage || !currentImageKey) return;
      const start = pointFromSvgPointer(event);
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
        const current = pointFromSvgPointer(event);
        const nextAnnotations = editAnnotationsForDrag(dragEdit, current, layerSize);
        setAnnotationsByImage((currentByImage) => ({
          ...currentByImage,
          [dragEdit.imageKey]: nextAnnotations,
        }));
        return;
      }

      if (selectionMarquee) {
        if (selectionMarquee.pointerId !== event.pointerId) return;
        const current = pointFromSvgPointer(event);
        setSelectionMarquee({ ...selectionMarquee, current });
        return;
      }

      if (!draft || !activeTool) return;
      const current = pointFromSvgPointer(event);
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
    [
      activeTool,
      color,
      draft,
      dragEdit,
      fontSize,
      layerSize,
      selectionMarquee,
      text,
      thickness,
    ],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (dragEdit) {
        if (dragEdit.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const current = pointFromSvgPointer(event);
        const moved = drawDistance(dragEdit.start, current) >= MIN_DRAW_DISTANCE;
        const nextSelectedIds = dragSelectionAfterPointerUp(dragEdit, moved);
        setDragEdit(null);
        setSelectedAnnotationIds(nextSelectedIds);
        if (!moved) return;
        const nextAnnotations = editAnnotationsForDrag(dragEdit, current, layerSize);
        if (currentImage && imageKey(currentImage) === dragEdit.imageKey) {
          commitAnnotations(currentImage, nextAnnotations, {
            historyAnnotations: dragEdit.originalAnnotations,
            historySelectionIds: dragEdit.selectionBeforeIds,
          });
        }
        setEditingTextId(null);
        return;
      }

      if (selectionMarquee) {
        if (selectionMarquee.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const current = pointFromSvgPointer(event);
        const moved = drawDistance(selectionMarquee.start, current) >=
          MIN_DRAW_DISTANCE;
        if (moved) {
          const rect = rectFromPoints(selectionMarquee.start, current);
          const marqueeIds = annotations
            .filter((annotation) =>
              boundsIntersectRect(
                annotationBounds(annotation, layerSize),
                rect,
              ),
            )
            .map((annotation) => annotation.id);
          setSelectedAnnotationIds(
            selectionMarquee.additive
              ? uniqueIds([...selectedAnnotationIds, ...marqueeIds])
              : marqueeIds,
          );
        } else if (!selectionMarquee.additive) {
          setSelectedAnnotationIds([]);
        }
        setSelectionMarquee(null);
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
      setSelectedAnnotationIds([draft.annotation.id]);
      if (draft.annotation.kind === "text") {
        setEditingTextId(draft.annotation.id);
        setOpenPanel(null);
      }
    },
    [
      annotations,
      annotationsByImage,
      commitAnnotations,
      currentImage,
      dragEdit,
      draft,
      layerSize,
      selectedAnnotationIds,
      selectionMarquee,
    ],
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
          setSelectedAnnotationIds([annotation.id]);
          return;
        }
        lastTextPointerDownRef.current = { annotationId: annotation.id, time: now };
      }
      const svg = event.currentTarget.ownerSVGElement;
      svg?.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      const pointer = pointFromSvgPointer(event);
      const originalAnnotations = annotationsByImage[currentImageKey] ?? [];
      const selectionBeforeIds = selectedAnnotationIds;
      const wasSelected = selectionBeforeIds.includes(annotation.id);
      const nextSelectedIds =
        mode === "move"
          ? event.shiftKey
            ? wasSelected
              ? selectionBeforeIds
              : uniqueIds([...selectionBeforeIds, annotation.id])
            : wasSelected
              ? selectionBeforeIds
              : [annotation.id]
          : [annotation.id];
      setActiveTool(null);
      setEditMode(true);
      setOpenPanel(null);
      setEditingTextId(null);
      setSelectedAnnotationIds(nextSelectedIds);
      setDragEdit({
        annotation,
        imageKey: currentImageKey,
        mode,
        originalAnnotations,
        pointerId: event.pointerId,
        selectedAnnotationIds: nextSelectedIds,
        selectionBeforeIds,
        shiftKey: event.shiftKey,
        start: pointer,
        wasSelected,
      });
    },
    [annotationsByImage, currentImageKey, disabled, selectedAnnotationIds],
  );

  const undoLast = useCallback(() => {
    if (!currentImage) return;
    const key = imageKey(currentImage);
    let historyIndex = -1;
    for (let index = historyRef.current.length - 1; index >= 0; index -= 1) {
      if (historyRef.current[index]?.imageKey === key) {
        historyIndex = index;
        break;
      }
    }
    if (historyIndex < 0) return;

    const entry = historyRef.current[historyIndex];
    historyRef.current = historyRef.current.filter(
      (_, index) => index !== historyIndex,
    );
    const restoredAnnotationIds = new Set(
      entry.annotations.map((annotation) => annotation.id),
    );
    setSelectedAnnotationIds(
      entry.selectedAnnotationIds.filter((id) => restoredAnnotationIds.has(id)),
    );
    commitAnnotations(currentImage, entry.annotations, { skipHistory: true });
  }, [commitAnnotations, currentImage]);

  const deleteSelected = useCallback(() => {
    if (!currentImage || !currentImageKey || selectedAnnotationIds.length === 0) {
      return;
    }
    const selectedIds = new Set(selectedAnnotationIds);
    const nextAnnotations = (annotationsByImage[currentImageKey] ?? []).filter(
      (annotation) => !selectedIds.has(annotation.id),
    );
    setSelectedAnnotationIds([]);
    commitAnnotations(currentImage, nextAnnotations);
  }, [
    annotationsByImage,
    commitAnnotations,
    currentImage,
    currentImageKey,
    selectedAnnotationIds,
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
        selectedAnnotationIds.length > 0 &&
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
  }, [deleteSelected, disabled, selectedAnnotationIds.length, undoLast]);

  const chooseTool = useCallback((kind: AnnotationKind) => {
    setActiveTool(kind);
    setEditMode(false);
    setEditingTextId(null);
    setOpenPanel(null);
    setSelectedAnnotationIds([]);
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
    setSelectedAnnotationIds([annotation.id]);
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
  const canvasInteractive = !disabled &&
    Boolean(activeTool || editMode || dragEdit || selectionMarquee);
  const activeColor = primarySelectedAnnotation?.color ?? color;
  const activeThickness = primarySelectedAnnotation?.thickness ?? thickness;
  const activeFontSize = primarySelectedAnnotation?.fontSize ?? fontSize;
  const activeText = selectedAnnotation?.kind === "text" ? selectedAnnotation.text || "" : text;
  const groupSelectionBounds =
    selectedAnnotations.length > 1
      ? annotationGroupBounds(selectedAnnotations, layerSize)
      : null;
  const marqueeBounds = selectionMarquee
    ? rectFromPoints(selectionMarquee.start, selectionMarquee.current)
    : null;
  const showMarquee = selectionMarquee
    ? drawDistance(selectionMarquee.start, selectionMarquee.current) >=
      MIN_DRAW_DISTANCE
    : false;
  const editingBounds = editingTextAnnotation
    ? textBounds(editingTextAnnotation, layerSize)
    : null;
  const inlineFontSize = editingTextAnnotation
    ? Math.max(12, editingTextAnnotation.fontSize)
    : undefined;
  const svgWidth = Math.max(1, layerSize.width);
  const svgHeight = Math.max(1, layerSize.height);

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
        onPointerCancel={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        preserveAspectRatio="none"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      >
        {visibleAnnotations.map((annotation) => (
          <AnnotationShape
            activeDragHandle={
              dragEdit?.annotation.id === annotation.id ? dragEdit.mode : null
            }
            annotation={annotation}
            editable={editMode && !activeTool && !disabled}
            key={annotation.id}
            layerSize={layerSize}
            onStartEditDrag={startEditDrag}
            onTextEdit={editTextAnnotation}
            primarySelected={primarySelectedAnnotation?.id === annotation.id}
            selected={selectedIdSet.has(annotation.id)}
          />
        ))}
        {groupSelectionBounds ? (
          <rect
            data-test-id="dicom-annotation-group-selection"
            fill="transparent"
            height={(groupSelectionBounds.maxY - groupSelectionBounds.minY) * svgHeight}
            pointerEvents="none"
            stroke={SELECTED_STROKE_COLOR}
            strokeOpacity={0.82}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            width={(groupSelectionBounds.maxX - groupSelectionBounds.minX) * svgWidth}
            x={groupSelectionBounds.minX * svgWidth}
            y={groupSelectionBounds.minY * svgHeight}
          />
        ) : null}
        {showMarquee && marqueeBounds ? (
          <rect
            data-test-id="dicom-annotation-selection-marquee"
            fill="#2f80ed"
            fillOpacity={0.12}
            height={marqueeBounds.height * svgHeight}
            pointerEvents="none"
            stroke={SELECTED_STROKE_COLOR}
            strokeDasharray="6 4"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            width={marqueeBounds.width * svgWidth}
            x={marqueeBounds.x * svgWidth}
            y={marqueeBounds.y * svgHeight}
          />
        ) : null}
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
            label={activeTool ? annotationKindLabel(activeTool) : "Draw"}
            onClick={() =>
              setOpenPanel((current) => (current === "draw" ? null : "draw"))
            }
          >
            <ChevronDown className="size-3.5" />
          </AnnotationToolbarButton>

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

      </div>

      {selectedAnnotations.length > 0 && editorPortalElement
        ? createPortal(
            selectedAnnotation ? (
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
              />
            ) : (
              <AnnotationSelectionRail
                activeColor={activeColor}
                activeThickness={activeThickness}
                disabled={disabled}
                onChooseColor={chooseColor}
                onChooseThickness={chooseThickness}
                selectedCount={selectedAnnotations.length}
              />
            ),
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
