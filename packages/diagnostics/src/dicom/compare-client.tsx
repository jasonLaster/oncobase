"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ImageIcon,
  LinkIcon,
  Move,
  RotateCcw,
  ScanSearch,
  SlidersHorizontal,
  ZoomIn,
} from "lucide-react";
import useSWR from "swr";

import { Badge, Button, cn } from "./ui.tsx";
import {
  DIAGNOSTIC_COMPARISON_SET_PARAM,
  type DiagnosticComparisonManifest,
  type DiagnosticComparisonsPayload,
  type SeriesPair,
  type SeriesSelector,
} from "./comparisons.ts";
import {
  findMatchedImageIndex,
  type ComparisonSide,
  type MatchResult,
  type MatchState,
} from "./comparison-matching.ts";
import {
  DIAGNOSTIC_STUDY_SET_PARAM,
  type DiagnosticStudiesPayload,
  type DiagnosticStudy,
} from "../studies/index.ts";
import {
  ensureCornerstoneModules,
  type CornerstoneModules,
} from "./cornerstone-runtime.ts";

type CornerstoneCore = typeof import("@cornerstonejs/core");
type StackViewport = InstanceType<CornerstoneCore["StackViewport"]>;
type ToolMode = "window" | "pan" | "zoom";

interface CornerstoneSynchronizer {
  add(viewportInfo: { renderingEngineId: string; viewportId: string }): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

interface DicomCatalog {
  root: string | null;
  rootsTried: string[];
  series: DicomSeries[];
}

interface DicomSeries {
  id: string;
  seriesKey: string;
  label: string;
  root: string;
  directory: string;
  relativeDirectory: string;
  modality: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  studyDate: string | null;
  seriesNumber: number | null;
  images: DicomImage[];
}

interface DicomImage {
  id: string;
  fileName: string;
  relativePath: string;
  byteLength: number;
  modifiedAt: string;
  imageId: string;
  instanceNumber: number | null;
  imagePosition: number | null;
  rows: number | null;
  columns: number | null;
}

interface ViewerImage {
  imageId: string;
  label: string;
  fileName: string;
  relativePath: string;
  instanceNumber: number | null;
  imagePosition: number | null;
  dimensions: string | null;
}

interface ActiveStack {
  id: string;
  title: string;
  sideLabel: string;
  study: DiagnosticStudy | null;
  series: DicomSeries;
  images: ViewerImage[];
}

interface ResolvedPair {
  pair: SeriesPair;
  leftStack: ActiveStack | null;
  rightStack: ActiveStack | null;
  leftResolution: string;
  rightResolution: string;
  warnings: string[];
}

interface DicomCompareClientProps {
  initialComparisonId?: string | null;
  initialStudySet?: string | null;
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

export function DicomCompareClient({
  initialComparisonId = null,
  initialStudySet = null,
}: DicomCompareClientProps) {
  const leftViewportElementRef = useRef<HTMLDivElement | null>(null);
  const rightViewportElementRef = useRef<HTMLDivElement | null>(null);
  const renderingEngineRef = useRef<InstanceType<CornerstoneCore["RenderingEngine"]> | null>(
    null,
  );
  const leftViewportRef = useRef<StackViewport | null>(null);
  const rightViewportRef = useRef<StackViewport | null>(null);
  const modulesRef = useRef<CornerstoneModules | null>(null);
  const zoomPanSynchronizerRef = useRef<CornerstoneSynchronizer | null>(null);
  const voiSynchronizerRef = useRef<CornerstoneSynchronizer | null>(null);
  const loadingRequestIdsRef = useRef({ left: 0, right: 0 });
  const sliceIndexesRef = useRef({ left: 0, right: 0 });
  const activePairRef = useRef<ResolvedPair | null>(null);
  const internalImageChangeRef = useRef(false);

  const renderingEngineId = useRef(`oncobase-dicom-compare-engine-${crypto.randomUUID()}`);
  const leftViewportId = useRef(`oncobase-dicom-compare-left-${crypto.randomUUID()}`);
  const rightViewportId = useRef(`oncobase-dicom-compare-right-${crypto.randomUUID()}`);
  const toolGroupId = useRef(`oncobase-dicom-compare-tools-${crypto.randomUUID()}`);
  const zoomPanSynchronizerId = useRef(`oncobase-dicom-compare-zoom-${crypto.randomUUID()}`);
  const voiSynchronizerId = useRef(`oncobase-dicom-compare-voi-${crypto.randomUUID()}`);

  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [sliceIndexes, setSliceIndexes] = useState({ left: 0, right: 0 });
  const [loadingIndexes, setLoadingIndexes] = useState<{
    left: number | null;
    right: number | null;
  }>({ left: null, right: null });
  const [matchInfo, setMatchInfo] = useState<MatchResult>({
    index: 0,
    state: "not comparable",
  });
  const syncSlices = true;
  const syncWindow = true;
  const syncZoomPan = true;
  const [toolMode, setToolMode] = useState<ToolMode>("window");
  const [error, setError] = useState<string | null>(null);

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams();
    if (initialStudySet) params.set(DIAGNOSTIC_COMPARISON_SET_PARAM, initialStudySet);
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [initialStudySet]);

  const diagnosticStudiesUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (initialStudySet) params.set(DIAGNOSTIC_STUDY_SET_PARAM, initialStudySet);
    const query = params.toString();
    return `/api/diagnostic-studies${query ? `?${query}` : ""}`;
  }, [initialStudySet]);

  const { data: catalog, error: catalogError } = useSWR<DicomCatalog>(
    "/api/dicom/studies",
    fetchJson,
    { revalidateOnFocus: false },
  );
  const { data: diagnosticStudiesPayload } = useSWR<DiagnosticStudiesPayload>(
    diagnosticStudiesUrl,
    fetchJson,
    { revalidateOnFocus: false },
  );
  const comparisonUrl = initialComparisonId
    ? `/api/dicom/comparisons/${encodeURIComponent(initialComparisonId)}${querySuffix}`
    : `/api/dicom/comparisons${querySuffix}`;
  const { data: comparisonData, error: comparisonError } = useSWR<
    DiagnosticComparisonManifest | DiagnosticComparisonsPayload
  >(comparisonUrl, fetchJson, { revalidateOnFocus: false });

  const diagnosticStudies = useMemo(
    () => diagnosticStudiesPayload?.studies ?? [],
    [diagnosticStudiesPayload],
  );
  const comparison = useMemo(() => {
    if (!comparisonData) return null;
    if ("comparisons" in comparisonData) return comparisonData.comparisons[0] ?? null;
    return comparisonData;
  }, [comparisonData]);

  const resolvedPairs = useMemo(
    () =>
      comparison?.seriesPairs.map((pair) =>
        resolvePair(pair, catalog?.series ?? [], diagnosticStudies),
      ) ?? [],
    [catalog?.series, comparison?.seriesPairs, diagnosticStudies],
  );

  const activePair = useMemo(() => {
    if (!resolvedPairs.length) return null;
    const selected = selectedPairId
      ? resolvedPairs.find((pair) => pair.pair.id === selectedPairId)
      : null;
    return selected ?? resolvedPairs.find((pair) => pair.leftStack && pair.rightStack) ?? resolvedPairs[0];
  }, [resolvedPairs, selectedPairId]);

  useEffect(() => {
    activePairRef.current = activePair;
  }, [activePair]);

  const leftStack = activePair?.leftStack ?? null;
  const rightStack = activePair?.rightStack ?? null;
  const hasStacks = Boolean(leftStack?.images.length && rightStack?.images.length);
  const leftCurrentImage =
    leftStack?.images[sliceIndexes.left] ?? leftStack?.images[0] ?? null;
  const rightCurrentImage =
    rightStack?.images[sliceIndexes.right] ?? rightStack?.images[0] ?? null;
  const displayError =
    error ??
    (catalogError instanceof Error
      ? catalogError.message
      : comparisonError instanceof Error
        ? comparisonError.message
        : catalogError || comparisonError
          ? "Could not load comparison data"
          : null);

  const applyToolMode = useCallback((mode: ToolMode) => {
    const modules = modulesRef.current;
    const toolGroup = modules?.tools.ToolGroupManager.getToolGroup(toolGroupId.current);
    if (!modules || !toolGroup) return;

    const { MouseBindings } = modules.tools.Enums;
    const oneFingerDrag = { numTouchPoints: 1 };
    const twoFingerPinchOrDrag = { numTouchPoints: 2 };
    const primaryTool =
      mode === "window"
        ? modules.tools.WindowLevelTool.toolName
        : mode === "pan"
          ? modules.tools.PanTool.toolName
          : modules.tools.ZoomTool.toolName;

    toolGroup.setToolPassive(modules.tools.WindowLevelTool.toolName, {
      removeAllBindings: true,
    });
    toolGroup.setToolPassive(modules.tools.PanTool.toolName, {
      removeAllBindings: true,
    });
    toolGroup.setToolPassive(modules.tools.ZoomTool.toolName, {
      removeAllBindings: true,
    });
    toolGroup.setToolActive(primaryTool, {
      bindings: [{ mouseButton: MouseBindings.Primary }, oneFingerDrag],
    });
    toolGroup.setToolActive(modules.tools.PanTool.toolName, {
      bindings:
        mode === "pan"
          ? [
              { mouseButton: MouseBindings.Primary },
              oneFingerDrag,
              { mouseButton: MouseBindings.Secondary },
            ]
          : [{ mouseButton: MouseBindings.Secondary }],
    });
    toolGroup.setToolActive(modules.tools.ZoomTool.toolName, {
      bindings:
        mode === "zoom"
          ? [
              { mouseButton: MouseBindings.Primary },
              oneFingerDrag,
              { mouseButton: MouseBindings.Auxiliary },
              twoFingerPinchOrDrag,
            ]
          : [{ mouseButton: MouseBindings.Auxiliary }, twoFingerPinchOrDrag],
    });
    toolGroup.setToolActive(modules.tools.StackScrollTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Wheel }],
    });
  }, []);

  useEffect(() => {
    applyToolMode(toolMode);
  }, [applyToolMode, toolMode]);

  useEffect(() => {
    zoomPanSynchronizerRef.current?.setEnabled(syncZoomPan);
    voiSynchronizerRef.current?.setEnabled(syncWindow);
  }, [syncWindow, syncZoomPan]);

  const setSideSliceIndex = useCallback((side: ComparisonSide, index: number) => {
    sliceIndexesRef.current = { ...sliceIndexesRef.current, [side]: index };
    setSliceIndexes((current) => ({ ...current, [side]: index }));
  }, []);

  const showViewportImage = useCallback(
    async (side: ComparisonSide, nextIndex: number) => {
      const stack =
        side === "left" ? activePairRef.current?.leftStack : activePairRef.current?.rightStack;
      const viewport = side === "left" ? leftViewportRef.current : rightViewportRef.current;
      const count = stack?.images.length ?? 0;
      if (!stack || !viewport || count === 0) return;

      const clamped = clampIndex(nextIndex, count);
      const requestId = loadingRequestIdsRef.current[side] + 1;
      loadingRequestIdsRef.current[side] = requestId;
      setLoadingIndexes((current) => ({ ...current, [side]: clamped }));
      setError(null);

      try {
        internalImageChangeRef.current = true;
        await viewport.setImageIdIndex(clamped);
        internalImageChangeRef.current = false;
        if (loadingRequestIdsRef.current[side] !== requestId) return;
        viewport.render();
        setSideSliceIndex(side, clamped);
        setLoadingIndexes((current) => ({ ...current, [side]: null }));
        const modules = modulesRef.current;
        if (modules) prefetchNearbyImages(modules.core, stack.images, clamped);
      } catch (caught) {
        internalImageChangeRef.current = false;
        if (loadingRequestIdsRef.current[side] !== requestId) return;
        setLoadingIndexes((current) => ({ ...current, [side]: null }));
        setError(caught instanceof Error ? caught.message : "Could not load comparison image");
      }
    },
    [setSideSliceIndex],
  );

  const handleStackNewImage = useCallback(
    async (side: ComparisonSide, event: Event, core: CornerstoneCore) => {
      const detail = (event as CustomEvent<{ imageIdIndex: number }>).detail;
      if (typeof detail?.imageIdIndex !== "number") return;
      const index = detail.imageIdIndex;
      setSideSliceIndex(side, index);

      const resolved = activePairRef.current;
      const stack = side === "left" ? resolved?.leftStack : resolved?.rightStack;
      if (stack) prefetchNearbyImages(core, stack.images, index);
      if (
        internalImageChangeRef.current ||
        !syncSlices ||
        !resolved?.leftStack ||
        !resolved.rightStack
      ) {
        return;
      }

      const sourceStack = side === "left" ? resolved.leftStack : resolved.rightStack;
      const targetStack = side === "left" ? resolved.rightStack : resolved.leftStack;
      const match = findMatchedImageIndex(
        resolved.pair,
        side,
        index,
        sourceStack.images,
        targetStack.images,
      );
      setMatchInfo(match);
      await showViewportImage(side === "left" ? "right" : "left", match.index);
    },
    [setSideSliceIndex, showViewportImage, syncSlices],
  );

  const showSyncedImage = useCallback(
    async (sourceSide: ComparisonSide, nextIndex: number) => {
      const resolved = activePairRef.current;
      if (!resolved?.leftStack || !resolved.rightStack) return;
      const sourceStack = sourceSide === "left" ? resolved.leftStack : resolved.rightStack;
      const targetStack = sourceSide === "left" ? resolved.rightStack : resolved.leftStack;
      await showViewportImage(sourceSide, nextIndex);

      if (!syncSlices) return;
      const match = findMatchedImageIndex(
        resolved.pair,
        sourceSide,
        clampIndex(nextIndex, sourceStack.images.length),
        sourceStack.images,
        targetStack.images,
      );
      setMatchInfo(match);
      await showViewportImage(sourceSide === "left" ? "right" : "left", match.index);
    },
    [showViewportImage, syncSlices],
  );

  useEffect(() => {
    const leftElement = leftViewportElementRef.current;
    const rightElement = rightViewportElementRef.current;
    const currentActivePair = activePair;
    const currentLeftStack = leftStack;
    const currentRightStack = rightStack;
    if (
      !currentActivePair ||
      !leftElement ||
      !rightElement ||
      !currentLeftStack?.images.length ||
      !currentRightStack?.images.length
    ) {
      return;
    }

    const currentLeftElement = leftElement;
    const currentRightElement = rightElement;
    const resolvedActivePair = currentActivePair;
    const resolvedLeftStack = currentLeftStack;
    const resolvedRightStack = currentRightStack;
    let cancelled = false;
    let removeListeners: (() => void) | null = null;

    async function loadStacks() {
      setError(null);
      try {
        const modules = await ensureCornerstoneModules();
        if (cancelled) return;
        modulesRef.current = modules;

        const { core, tools } = modules;
        let renderingEngine = renderingEngineRef.current;
        if (!renderingEngine) {
          renderingEngine = new core.RenderingEngine(renderingEngineId.current);
          renderingEngine.enableElement({
            viewportId: leftViewportId.current,
            type: core.Enums.ViewportType.STACK,
            element: currentLeftElement,
            defaultOptions: { background: [0, 0, 0] },
          });
          renderingEngine.enableElement({
            viewportId: rightViewportId.current,
            type: core.Enums.ViewportType.STACK,
            element: currentRightElement,
            defaultOptions: { background: [0, 0, 0] },
          });
          renderingEngineRef.current = renderingEngine;
        }

        let toolGroup = tools.ToolGroupManager.getToolGroup(toolGroupId.current);
        if (!toolGroup) {
          toolGroup = tools.ToolGroupManager.createToolGroup(toolGroupId.current);
          toolGroup?.addTool(tools.WindowLevelTool.toolName);
          toolGroup?.addTool(tools.PanTool.toolName);
          toolGroup?.addTool(tools.ZoomTool.toolName);
          toolGroup?.addTool(tools.StackScrollTool.toolName);
          toolGroup?.addViewport(leftViewportId.current, renderingEngineId.current);
          toolGroup?.addViewport(rightViewportId.current, renderingEngineId.current);
        }

        if (!zoomPanSynchronizerRef.current) {
          const synchronizer = tools.synchronizers.createZoomPanSynchronizer(
            zoomPanSynchronizerId.current,
          );
          synchronizer.add({
            renderingEngineId: renderingEngineId.current,
            viewportId: leftViewportId.current,
          });
          synchronizer.add({
            renderingEngineId: renderingEngineId.current,
            viewportId: rightViewportId.current,
          });
          synchronizer.setEnabled(syncZoomPan);
          zoomPanSynchronizerRef.current = synchronizer;
        }

        if (!voiSynchronizerRef.current) {
          const synchronizer = tools.synchronizers.createVOISynchronizer(
            voiSynchronizerId.current,
            { syncInvertState: true, syncColormap: false },
          );
          synchronizer.add({
            renderingEngineId: renderingEngineId.current,
            viewportId: leftViewportId.current,
          });
          synchronizer.add({
            renderingEngineId: renderingEngineId.current,
            viewportId: rightViewportId.current,
          });
          synchronizer.setEnabled(syncWindow);
          voiSynchronizerRef.current = synchronizer;
        }

        applyToolMode(toolMode);

        const leftViewport = renderingEngine.getViewport(
          leftViewportId.current,
        ) as StackViewport;
        const rightViewport = renderingEngine.getViewport(
          rightViewportId.current,
        ) as StackViewport;
        leftViewportRef.current = leftViewport;
        rightViewportRef.current = rightViewport;

        const leftImageIds = resolvedLeftStack.images.map((image) => image.imageId);
        const rightImageIds = resolvedRightStack.images.map((image) => image.imageId);
        const leftInitial = clampIndex(
          resolvedActivePair.pair.defaultSlice ?? Math.floor(leftImageIds.length / 2),
          leftImageIds.length,
        );
        const initialMatch = findMatchedImageIndex(
          resolvedActivePair.pair,
          "left",
          leftInitial,
          resolvedLeftStack.images,
          resolvedRightStack.images,
        );
        const rightInitial = clampIndex(initialMatch.index, rightImageIds.length);

        await Promise.all([
          waitForElementSize(currentLeftElement),
          waitForElementSize(currentRightElement),
        ]);
        setLoadingIndexes({ left: leftInitial, right: rightInitial });
        await Promise.all([
          leftViewport.setStack(leftImageIds, leftInitial),
          rightViewport.setStack(rightImageIds, rightInitial),
        ]);
        if (cancelled) return;

        renderingEngine.resize(true, false);
        leftViewport.resetCamera();
        leftViewport.resetProperties();
        rightViewport.resetCamera();
        rightViewport.resetProperties();
        leftViewport.render();
        rightViewport.render();
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          renderingEngine?.resize(true, true);
          leftViewport.render();
          rightViewport.render();
        });

        setSliceIndexes({ left: leftInitial, right: rightInitial });
        sliceIndexesRef.current = { left: leftInitial, right: rightInitial };
        setMatchInfo(initialMatch);
        setLoadingIndexes({ left: null, right: null });
        prefetchNearbyImages(modules.core, resolvedLeftStack.images, leftInitial);
        prefetchNearbyImages(modules.core, resolvedRightStack.images, rightInitial);

        const leftListener = (event: Event) => {
          void handleStackNewImage("left", event, modules.core);
        };
        const rightListener = (event: Event) => {
          void handleStackNewImage("right", event, modules.core);
        };
        currentLeftElement.addEventListener(core.Enums.Events.STACK_NEW_IMAGE, leftListener);
        currentRightElement.addEventListener(core.Enums.Events.STACK_NEW_IMAGE, rightListener);
        removeListeners = () => {
          currentLeftElement.removeEventListener(
            core.Enums.Events.STACK_NEW_IMAGE,
            leftListener,
          );
          currentRightElement.removeEventListener(
            core.Enums.Events.STACK_NEW_IMAGE,
            rightListener,
          );
        };
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not initialize comparison");
      }
    }

    loadStacks();

    return () => {
      cancelled = true;
      removeListeners?.();
    };
  }, [
    activePair,
    applyToolMode,
    handleStackNewImage,
    leftStack,
    rightStack,
    syncWindow,
    syncZoomPan,
    toolMode,
  ]);

  useEffect(() => {
    const leftElement = leftViewportElementRef.current;
    const rightElement = rightViewportElementRef.current;
    if (!leftElement || !rightElement) return;

    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        renderingEngineRef.current?.resize(true, true);
        leftViewportRef.current?.render();
        rightViewportRef.current?.render();
      });
    });
    observer.observe(leftElement);
    observer.observe(rightElement);
    return () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const currentToolGroupId = toolGroupId.current;
    return () => {
      zoomPanSynchronizerRef.current?.destroy();
      voiSynchronizerRef.current?.destroy();
      const modules = modulesRef.current;
      if (modules) {
        modules.tools.ToolGroupManager.destroyToolGroup(currentToolGroupId);
      }
      renderingEngineRef.current?.destroy();
    };
  }, []);

  function resetViewports() {
    leftViewportRef.current?.resetCamera();
    leftViewportRef.current?.resetProperties();
    leftViewportRef.current?.render();
    rightViewportRef.current?.resetCamera();
    rightViewportRef.current?.resetProperties();
    rightViewportRef.current?.render();
  }

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("a, button, input, select, textarea") || target.isContentEditable)
      ) {
        return;
      }
      if (!hasStacks) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        void showSyncedImage(event.shiftKey ? "right" : "left", sliceIndexesRef.current.left + 1);
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        void showSyncedImage(event.shiftKey ? "right" : "left", sliceIndexesRef.current.left - 1);
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetViewports();
      }
    },
    [hasStacks, showSyncedImage],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const matchLabel = matchLabelForState(matchInfo.state);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#08090a] text-zinc-100">
      <header className="shrink-0 border-b border-white/10 bg-[#11151a] px-3 py-2 lg:px-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-normal lg:text-lg">
                {comparison?.label ?? "DICOM comparison"}
              </h1>
              <Badge variant="outline" className="border-white/15 text-zinc-300">
                {comparison?.modality ?? "DICOM"}
              </Badge>
              <Badge
                variant="outline"
                className={cn("border-white/15", matchStateClass(matchInfo.state))}
                data-test-id="dicom-compare-match-state"
              >
                {matchLabel}
                {typeof matchInfo.zDelta === "number"
                  ? ` · Δz ${formatNumber(matchInfo.zDelta)}`
                  : ""}
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl truncate text-xs text-zinc-400">
              {comparison?.caveat ??
                "Computational comparison and clinical context, not a diagnostic radiology report."}
            </p>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-cols-[260px_minmax(0,1fr)_300px] lg:grid-rows-none">
        <aside className="min-h-0 overflow-x-auto border-b border-white/10 bg-[#11151a] lg:overflow-y-auto lg:border-r lg:border-b-0">
          <div className="flex gap-2 p-2.5 lg:block lg:space-y-2 lg:p-3">
            {resolvedPairs.map((resolved) => {
              const selected = activePair?.pair.id === resolved.pair.id;
              const disabled = !resolved.leftStack || !resolved.rightStack;
              return (
                <button
                  key={resolved.pair.id}
                  type="button"
                  className={cn(
                    "w-56 shrink-0 rounded-lg border p-2.5 text-left transition-colors lg:w-full",
                    selected
                      ? "border-emerald-300/50 bg-emerald-300/12"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
                    disabled && "opacity-60",
                  )}
                  onClick={() => setSelectedPairId(resolved.pair.id)}
                  data-test-id={`dicom-compare-pair-${resolved.pair.id}`}
                >
                  <div className="flex items-start gap-2">
                    <ImageIcon className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">
                        {resolved.pair.label}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {resolved.pair.preset}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="border-white/15 text-zinc-300">
                      {resolved.pair.matchingStrategy}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-white/15",
                        disabled ? "text-amber-100" : "text-emerald-100",
                      )}
                    >
                      {disabled ? "Needs series" : "Resolved"}
                    </Badge>
                  </div>
                </button>
              );
            })}
            {!comparison && !displayError ? (
              <div className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-300">
                Loading comparison manifest.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col bg-black">
          <div
            className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-px bg-white/10 md:grid-cols-2 md:grid-rows-1"
            data-test-id="dicom-compare-viewports"
          >
            <ComparisonViewport
              side="left"
              stack={leftStack}
              currentImage={leftCurrentImage}
              sliceIndex={sliceIndexes.left}
              loadingIndex={loadingIndexes.left}
              viewportRef={leftViewportElementRef}
              emptyLabel="Baseline series not resolved"
            />
            <ComparisonViewport
              side="right"
              stack={rightStack}
              currentImage={rightCurrentImage}
              sliceIndex={sliceIndexes.right}
              loadingIndex={loadingIndexes.right}
              viewportRef={rightViewportElementRef}
              emptyLabel="Follow-up series not resolved"
            />
          </div>

          <div
            className="flex shrink-0 flex-col gap-2 border-t border-white/10 bg-[#0d1013] px-2 py-2 lg:flex-row lg:items-center lg:gap-3"
            data-test-id="dicom-compare-controls"
          >
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
              <ToolButton
                active={toolMode === "window"}
                icon={<SlidersHorizontal className="size-4" />}
                label="W/L"
                onClick={() => setToolMode("window")}
              />
              <ToolButton
                active={toolMode === "pan"}
                icon={<Move className="size-4" />}
                label="Pan"
                onClick={() => setToolMode((mode) => (mode === "pan" ? "window" : "pan"))}
              />
              <ToolButton
                active={toolMode === "zoom"}
                icon={<ZoomIn className="size-4" />}
                label="Zoom"
                onClick={() => setToolMode((mode) => (mode === "zoom" ? "window" : "zoom"))}
              />
              <Button
                variant="ghost"
                size="icon"
                className="text-zinc-300 hover:bg-white/10"
                onClick={resetViewports}
                disabled={!hasStacks}
                title="Reset both viewports"
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-zinc-300 hover:bg-white/10"
                disabled={!hasStacks || sliceIndexes.left <= 0}
                onClick={() => void showSyncedImage("left", sliceIndexes.left - 1)}
                title="Previous matched slice"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <div className="min-w-28 flex-1 px-1 sm:min-w-44 sm:px-2">
                <input
                  className="h-2 w-full accent-emerald-300"
                  type="range"
                  min={0}
                  max={Math.max(0, (leftStack?.images.length ?? 1) - 1)}
                  value={loadingIndexes.left ?? sliceIndexes.left}
                  disabled={!hasStacks}
                  onChange={(event) => void showSyncedImage("left", Number(event.currentTarget.value))}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-zinc-300 hover:bg-white/10"
                disabled={
                  !hasStacks || sliceIndexes.left >= (leftStack?.images.length ?? 1) - 1
                }
                onClick={() => void showSyncedImage("left", sliceIndexes.left + 1)}
                title="Next matched slice"
              >
                <ChevronRight className="size-4" />
              </Button>
              <div className="shrink-0 font-mono text-xs text-zinc-400">
                <span data-test-id="dicom-compare-left-counter">
                  {leftStack
                    ? `${(loadingIndexes.left ?? sliceIndexes.left) + 1} / ${leftStack.images.length}`
                    : "0 / 0"}
                </span>
                <span className="px-1.5 text-zinc-600">|</span>
                <span data-test-id="dicom-compare-right-counter">
                  {rightStack
                    ? `${(loadingIndexes.right ?? sliceIndexes.right) + 1} / ${rightStack.images.length}`
                    : "0 / 0"}
                </span>
              </div>
            </div>
          </div>

          {displayError ? (
            <div className="absolute right-3 bottom-3 max-w-md rounded-lg border border-red-400/30 bg-red-950/90 p-3 text-sm text-red-100 shadow-lg">
              {displayError}
            </div>
          ) : null}
        </main>

        <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#11151a] lg:border-t-0 lg:border-l">
          <div className="space-y-4 p-3">
            <section>
              <h2 className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">
                Series Match
              </h2>
              <dl className="mt-3 space-y-3 text-sm">
                <MetaRow label="Preset" value={activePair?.pair.preset} />
                <MetaRow label="Strategy" value={activePair?.pair.matchingStrategy} />
                <MetaRow label="Left resolution" value={activePair?.leftResolution} />
                <MetaRow label="Right resolution" value={activePair?.rightResolution} />
                <MetaRow label="Left z" value={formatPosition(leftCurrentImage?.imagePosition)} />
                <MetaRow label="Right z" value={formatPosition(rightCurrentImage?.imagePosition)} />
              </dl>
            </section>

            {activePair?.warnings.length ? (
              <section className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                <div className="mb-1 font-semibold">Comparison warnings</div>
                <ul className="list-disc space-y-1 pl-4">
                  {activePair.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {comparison?.reportAnchors.length ? (
              <section>
                <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-300 uppercase">
                  <FileText className="size-4" />
                  Report Anchors
                </h2>
                <div className="space-y-2">
                  {comparison.reportAnchors.map((anchor) => (
                    <div
                      key={`${anchor.side ?? "both"}-${anchor.label}`}
                      className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                        <span>{anchor.label}</span>
                        {anchor.side ? (
                          <Badge variant="outline" className="border-white/15 text-zinc-400">
                            {anchor.side}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-400">{anchor.text}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {comparison?.precomputedPanels.length ? (
              <section>
                <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-300 uppercase">
                  <LinkIcon className="size-4" />
                  Report Panels
                </h2>
                <div className="space-y-2">
                  {comparison.precomputedPanels.map((panel) => (
                    <a
                      key={panel.href}
                      href={panel.href}
                      className="block rounded-lg border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
                      data-test-id="dicom-compare-precomputed-panel"
                    >
                      <div className="text-sm font-medium text-zinc-100">{panel.label}</div>
                      {panel.note ? (
                        <div className="mt-1 text-xs leading-5 text-zinc-400">{panel.note}</div>
                      ) : null}
                    </a>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ComparisonViewport({
  side,
  stack,
  currentImage,
  sliceIndex,
  loadingIndex,
  viewportRef,
  emptyLabel,
}: {
  side: ComparisonSide;
  stack: ActiveStack | null;
  currentImage: ViewerImage | null;
  sliceIndex: number;
  loadingIndex: number | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  emptyLabel: string;
}) {
  return (
    <section
      className="relative min-h-[220px] touch-none overflow-hidden bg-black select-none md:min-h-0"
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`${side} DICOM comparison viewport`}
      data-test-id={`dicom-compare-${side}-frame`}
    >
      <div
        ref={viewportRef}
        className="absolute inset-0 touch-none bg-black select-none"
        data-test-id={`dicom-compare-${side}-viewport`}
      />
      <div className="pointer-events-none absolute top-2 left-2 max-w-[calc(100%-1rem)] rounded-md border border-white/10 bg-black/70 px-2.5 py-2 shadow-lg">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-white/15 text-zinc-300">
            {side === "left" ? "Baseline" : "Follow-up"}
          </Badge>
          <span className="truncate text-sm font-medium text-zinc-100">
            {stack?.study?.dateLabel ?? stack?.series.studyDate ?? side}
          </span>
        </div>
        <div className="mt-1 max-w-md truncate text-xs text-zinc-400">
          {stack?.series.seriesDescription ?? stack?.title ?? emptyLabel}
        </div>
      </div>
      <div className="pointer-events-none absolute right-2 bottom-2 rounded-md border border-white/10 bg-black/70 px-2.5 py-1.5 font-mono text-xs text-zinc-300 shadow-lg">
        {stack ? `${(loadingIndex ?? sliceIndex) + 1} / ${stack.images.length}` : "0 / 0"}
      </div>
      {loadingIndex !== null ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 px-6 text-center backdrop-blur-[1px]"
          aria-live="polite"
          data-test-id={`dicom-compare-${side}-loading`}
        >
          <div className="rounded-lg border border-white/10 bg-black/80 px-4 py-3 shadow-lg">
            <div className="mx-auto mb-3 size-7 animate-spin rounded-full border-2 border-white/20 border-t-emerald-300" />
            <div className="text-sm font-medium text-zinc-100">
              Loading {side} image {loadingIndex + 1}
            </div>
            <div className="mt-1 max-w-56 truncate text-xs text-zinc-400">
              {currentImage?.fileName ?? stack?.title}
            </div>
          </div>
        </div>
      ) : null}
      {!stack ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center">
          <div className="max-w-sm">
            <ScanSearch className="mx-auto mb-4 size-10 text-zinc-500" />
            <div className="text-sm font-medium text-zinc-200">{emptyLabel}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function resolvePair(
  pair: SeriesPair,
  series: DicomSeries[],
  diagnosticStudies: DiagnosticStudy[],
): ResolvedPair {
  const left = resolveSeries(pair.leftSelector, series, diagnosticStudies);
  const right = resolveSeries(pair.rightSelector, series, diagnosticStudies);
  const warnings = comparisonWarnings(pair, left.series, right.series);

  return {
    pair,
    leftStack: left.series ? toActiveStack(left.series, "Baseline", left.study) : null,
    rightStack: right.series ? toActiveStack(right.series, "Follow-up", right.study) : null,
    leftResolution: left.reason,
    rightResolution: right.reason,
    warnings,
  };
}

function resolveSeries(
  selector: SeriesSelector,
  series: DicomSeries[],
  diagnosticStudies: DiagnosticStudy[],
) {
  const study = diagnosticStudies.find((candidate) => candidate.id === selector.studyId) ?? null;
  const renderableSeries = series.filter(isRenderableSeries);
  const studyCandidates = study
    ? renderableSeries.filter(
        (candidate) =>
          candidate.studyDate === study.isoDate &&
          candidate.relativeDirectory
            .toLowerCase()
            .includes(study.directoryIncludes.toLowerCase()),
      )
    : renderableSeries;
  const candidates = studyCandidates.length ? studyCandidates : renderableSeries;

  if (selector.seriesKey) {
    const byKey = candidates.find((candidate) => candidate.seriesKey === selector.seriesKey);
    if (byKey) return { series: byKey, study, reason: "series key" };
  }

  const byNumber = candidates.filter(
    (candidate) =>
      selector.seriesNumber !== undefined && candidate.seriesNumber === selector.seriesNumber,
  );
  const byNumberAndDescription = byNumber.find((candidate) =>
    descriptionsMatch(candidate.seriesDescription, selector.description),
  );
  if (byNumberAndDescription) return { series: byNumberAndDescription, study, reason: "number + description" };
  if (byNumber.length === 1) return { series: byNumber[0], study, reason: "series number" };

  const byDescription = candidates.find((candidate) =>
    descriptionsMatch(candidate.seriesDescription, selector.description),
  );
  if (byDescription) return { series: byDescription, study, reason: "description" };

  return { series: null, study, reason: "not resolved" };
}

function toActiveStack(
  series: DicomSeries,
  sideLabel: string,
  study: DiagnosticStudy | null,
): ActiveStack {
  return {
    id: series.id,
    title: series.label,
    sideLabel,
    study,
    series,
    images: series.images.map((image, index) => ({
      imageId: `wadouri:${image.imageId}`,
      label: image.instanceNumber ? `#${image.instanceNumber}` : `Slice ${index + 1}`,
      fileName: image.fileName,
      relativePath: image.relativePath,
      instanceNumber: image.instanceNumber,
      imagePosition: image.imagePosition,
      dimensions: image.rows && image.columns ? `${image.columns} x ${image.rows}` : null,
    })),
  };
}

function comparisonWarnings(
  pair: SeriesPair,
  left: DicomSeries | null,
  right: DicomSeries | null,
) {
  const warnings: string[] = [];
  if (!left || !right) {
    warnings.push("One or both series could not be resolved from the live DICOM catalog.");
    return warnings;
  }
  if ((left.modality ?? "").toUpperCase() !== (right.modality ?? "").toUpperCase()) {
    warnings.push("Series modalities differ.");
  }
  if (!left.images.some((image) => image.imagePosition !== null) || !right.images.some((image) => image.imagePosition !== null)) {
    warnings.push("One or both series lack image-position geometry; slice sync may use index fallback.");
  }
  if (!sameTuple(pair.leftSelector.pixelSpacing, pair.rightSelector.pixelSpacing)) {
    warnings.push("Pixel spacing differs between the curated series selectors.");
  }
  if (
    pair.leftSelector.sliceThickness !== undefined &&
    pair.rightSelector.sliceThickness !== undefined &&
    Math.abs(pair.leftSelector.sliceThickness - pair.rightSelector.sliceThickness) > 0.05
  ) {
    warnings.push("Slice thickness differs between the curated series selectors.");
  }
  return warnings;
}

function isRenderableSeries(series: DicomSeries) {
  return !new Set(["PR", "SR", "OT"]).has((series.modality ?? "").toUpperCase());
}

function descriptionsMatch(candidate: string | null | undefined, selector: string | undefined) {
  if (!selector) return false;
  const left = normalizeDescription(candidate);
  const right = normalizeDescription(selector);
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeDescription(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function sameTuple(
  left: [number, number] | undefined,
  right: [number, number] | undefined,
) {
  if (!left || !right) return true;
  return Math.abs(left[0] - right[0]) <= 0.001 && Math.abs(left[1] - right[1]) <= 0.001;
}

function ToolButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10",
        active && "border-emerald-300/50 bg-emerald-300/15 text-emerald-100",
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Button>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 break-words text-zinc-200">{value || "—"}</dd>
    </div>
  );
}

function waitForElementSize(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let frames = 0;
    const tick = () => {
      const nextRect = element.getBoundingClientRect();
      frames += 1;
      if (nextRect.width > 0 && nextRect.height > 0) {
        resolve();
        return;
      }
      if (frames > 120) {
        resolve();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
}

function prefetchNearbyImages(
  core: CornerstoneCore,
  images: ViewerImage[],
  currentIndex: number,
) {
  const candidateIndexes = [
    currentIndex + 1,
    currentIndex - 1,
    currentIndex + 2,
    currentIndex - 2,
  ];

  for (const index of candidateIndexes) {
    const imageId = images[index]?.imageId;
    if (!imageId) continue;
    void core.imageLoader
      .loadAndCacheImage(imageId, {
        priority: 0,
        requestType: "prefetch",
      })
      .catch(() => {
        // Prefetch is opportunistic; active navigation surfaces real load errors.
      });
  }
}

function clampIndex(index: number, length: number) {
  return Math.max(0, Math.min(index, Math.max(0, length - 1)));
}

function matchLabelForState(state: MatchState) {
  switch (state) {
    case "exact":
      return "Exact z";
    case "nearest":
      return "Nearest z";
    case "manual":
      return "Manual pair";
    case "index fallback":
      return "Index fallback";
    case "not comparable":
      return "Not comparable";
  }
}

function matchStateClass(state: MatchState) {
  if (state === "exact" || state === "manual") return "text-emerald-100";
  if (state === "nearest") return "text-sky-100";
  if (state === "index fallback") return "text-amber-100";
  return "text-zinc-400";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPosition(value: number | null | undefined) {
  return typeof value === "number" ? formatNumber(value) : null;
}
