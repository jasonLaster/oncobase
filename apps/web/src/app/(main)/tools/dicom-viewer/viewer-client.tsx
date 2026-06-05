"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ImageIcon,
  Info,
  Move,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  ScanSearch,
  SlidersHorizontal,
  ZoomIn,
} from "lucide-react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setResizableSidebarWidth } from "@/components/resizable-sidebar-store";
import {
  DIAGNOSTIC_BIOPSIES,
  getDiagnosticBiopsyById,
  type DiagnosticBiopsy,
} from "@/lib/diagnostic-biopsies";
import { cn } from "@/lib/utils";

type CornerstoneCore = typeof import("@cornerstonejs/core");
type CornerstoneTools = typeof import("@cornerstonejs/tools");
type DicomImageLoader = typeof import("@cornerstonejs/dicom-image-loader");

type ToolMode = "window" | "pan" | "zoom";

interface DicomCatalog {
  root: string | null;
  rootsTried: string[];
  series: DicomSeries[];
}

interface DicomSeries {
  id: string;
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
  byteLength: number | null;
  instanceNumber: number | null;
  dimensions: string | null;
}

interface ActiveStack {
  id: string;
  title: string;
  source: "blob" | "local";
  modality: string | null;
  studyDate: string | null;
  directory: string;
  images: ViewerImage[];
}

interface CornerstoneModules {
  core: CornerstoneCore;
  tools: CornerstoneTools;
  dicomLoader: DicomImageLoader;
}

let cornerstoneModulesPromise: Promise<CornerstoneModules> | null = null;

async function fetchDicomCatalog(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
  return (await response.json()) as DicomCatalog;
}

async function ensureCornerstone() {
  if (cornerstoneModulesPromise) return cornerstoneModulesPromise;

  cornerstoneModulesPromise = Promise.all([
    import("@cornerstonejs/core"),
    import("@cornerstonejs/tools"),
    import("@cornerstonejs/dicom-image-loader"),
  ]).then(async ([core, tools, dicomLoader]) => {
    if (!core.isCornerstoneInitialized()) {
      await core.init({
        debug: {},
        rendering: {
          renderingEngineMode: "contextPool",
          webGlContextCount: 3,
        },
      });
    }

    dicomLoader.init({
      maxWebWorkers: Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4)),
    });

    tools.init();
    safeAddTool(tools, tools.WindowLevelTool);
    safeAddTool(tools, tools.PanTool);
    safeAddTool(tools, tools.ZoomTool);
    safeAddTool(tools, tools.StackScrollTool);

    return { core, tools, dicomLoader };
  });

  return cornerstoneModulesPromise;
}

function safeAddTool(tools: CornerstoneTools, ToolClass: unknown) {
  try {
    tools.addTool(ToolClass);
  } catch {
    // Global tool registration is process-wide; repeated client mounts are fine.
  }
}

interface DicomViewerClientProps {
  initialBiopsyId?: string | null;
  initialSeriesId?: string | null;
}

export function DicomViewerClient({
  initialBiopsyId = null,
  initialSeriesId = null,
}: DicomViewerClientProps) {
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const renderingEngineRef = useRef<InstanceType<CornerstoneCore["RenderingEngine"]> | null>(
    null,
  );
  const viewportRef = useRef<InstanceType<CornerstoneCore["StackViewport"]> | null>(null);
  const modulesRef = useRef<CornerstoneModules | null>(null);
  const sliceIndexRef = useRef(0);
  const imageRequestIdRef = useRef(0);

  const renderingEngineId = useRef(`oncobase-dicom-engine-${crypto.randomUUID()}`);
  const viewportId = useRef(`oncobase-dicom-viewport-${crypto.randomUUID()}`);
  const toolGroupId = useRef(`oncobase-dicom-tools-${crypto.randomUUID()}`);

  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(
    initialSeriesId,
  );
  const [sliceIndex, setSliceIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>("window");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isInverted, setIsInverted] = useState(false);
  const [loadingImageIndex, setLoadingImageIndex] = useState<number | null>(null);
  const [stackRailOpen, setStackRailOpen] = useState(true);
  const {
    data: catalog,
    error: catalogError,
  } = useSWR<DicomCatalog>("/api/dicom/studies", fetchDicomCatalog, {
    revalidateOnFocus: false,
  });

  const renderableSeries = useMemo(
    () => catalog?.series.filter(isRenderableSeries) ?? [],
    [catalog],
  );

  const requestedBiopsy = useMemo(
    () => getDiagnosticBiopsyById(initialBiopsyId),
    [initialBiopsyId],
  );

  const displaySeries = useMemo(
    () =>
      requestedBiopsy
        ? renderableSeries.filter((series) => matchesBiopsySeries(series, requestedBiopsy))
        : renderableSeries,
    [renderableSeries, requestedBiopsy],
  );

  const preferredSeriesId = useMemo(() => {
    const requestedBiopsySeries = findSeriesForBiopsy(displaySeries, initialBiopsyId);
    const preferred =
      requestedBiopsySeries ??
      findSeriesForBiopsy(renderableSeries, "biopsy-2026-04-10") ??
      renderableSeries[0];
    return preferred?.id ?? null;
  }, [displaySeries, initialBiopsyId, renderableSeries]);

  const selectedSeries = useMemo(() => {
    const id = selectedSeriesId ?? preferredSeriesId;
    if (!id) return null;
    return (
      displaySeries.find((series) => series.id === id) ??
      displaySeries.find((series) => series.id === preferredSeriesId) ??
      null
    );
  }, [displaySeries, preferredSeriesId, selectedSeriesId]);

  const selectedBiopsy = useMemo(
    () => findBiopsyForSeries(selectedSeries) ?? requestedBiopsy,
    [requestedBiopsy, selectedSeries],
  );

  const activeStack = useMemo<ActiveStack | null>(() => {
    if (!selectedSeries) return null;

    return {
      id: selectedSeries.id,
      title: selectedSeries.label,
      source: selectedSeries.root === "vercel-blob" ? "blob" : "local",
      modality: selectedSeries.modality,
      studyDate: selectedSeries.studyDate,
      directory: selectedSeries.relativeDirectory,
      images: selectedSeries.images.map((image, index) => ({
        imageId: `wadouri:${image.imageId}`,
        label: image.instanceNumber ? `#${image.instanceNumber}` : `Slice ${index + 1}`,
        fileName: image.fileName,
        relativePath: image.relativePath,
        byteLength: image.byteLength,
        instanceNumber: image.instanceNumber,
        dimensions:
          image.rows && image.columns ? `${image.columns} x ${image.rows}` : null,
      })),
    };
  }, [selectedSeries]);

  const currentImage = activeStack?.images[sliceIndex] ?? activeStack?.images[0] ?? null;
  const loadingImage =
    loadingImageIndex !== null ? activeStack?.images[loadingImageIndex] : null;
  const displayError =
    error ??
    (catalogError instanceof Error
      ? catalogError.message
      : catalogError
        ? "Could not load DICOM catalog"
        : null);

  const applyToolMode = useCallback((mode: ToolMode) => {
    const modules = modulesRef.current;
    const toolGroup = modules?.tools.ToolGroupManager.getToolGroup(toolGroupId.current);
    if (!modules || !toolGroup) return;

    const { MouseBindings } = modules.tools.Enums;
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
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
    toolGroup.setToolActive(modules.tools.PanTool.toolName, {
      bindings:
        mode === "pan"
          ? [
              { mouseButton: MouseBindings.Primary },
              { mouseButton: MouseBindings.Secondary },
            ]
          : [{ mouseButton: MouseBindings.Secondary }],
    });
    toolGroup.setToolActive(modules.tools.ZoomTool.toolName, {
      bindings:
        mode === "zoom"
          ? [
              { mouseButton: MouseBindings.Primary },
              { mouseButton: MouseBindings.Auxiliary },
            ]
          : [{ mouseButton: MouseBindings.Auxiliary }],
    });
    toolGroup.setToolActive(modules.tools.StackScrollTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Wheel }],
    });
  }, []);

  useEffect(() => {
    applyToolMode(toolMode);
  }, [applyToolMode, toolMode]);

  useEffect(() => {
    const element = viewportElementRef.current;
    const stack = activeStack;
    if (!element || !stack?.images.length) return;
    const viewportElement = element;
    const currentStack = stack;

    let cancelled = false;
    let removeListener: (() => void) | null = null;

    async function loadStack() {
      setError(null);
      try {
        const modules = await ensureCornerstone();
        if (cancelled) return;
        modulesRef.current = modules;

        const { core, tools } = modules;
        let renderingEngine = renderingEngineRef.current;
        if (!renderingEngine) {
          renderingEngine = new core.RenderingEngine(renderingEngineId.current);
          renderingEngine.enableElement({
            viewportId: viewportId.current,
            type: core.Enums.ViewportType.STACK,
              element: viewportElement,
            defaultOptions: {
              background: [0, 0, 0],
            },
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
          toolGroup?.addViewport(viewportId.current, renderingEngineId.current);
        }

        applyToolMode(toolMode);

        const viewport = renderingEngine.getViewport(
          viewportId.current,
        ) as InstanceType<CornerstoneCore["StackViewport"]>;
        viewportRef.current = viewport;

        const imageIds = currentStack.images.map((image) => image.imageId);
        const initialIndex = imageIds.length > 1 ? Math.floor(imageIds.length / 2) : 0;
        await viewport.setStack(imageIds, initialIndex);
        if (cancelled) return;

        viewport.resetCamera();
        viewport.resetProperties();
        viewport.render();
        renderingEngine.resize(true, false);

        setSliceIndex(initialIndex);
        sliceIndexRef.current = initialIndex;
        setLoadingImageIndex(null);
        setIsInverted(false);
        prefetchNearbyImages(modules.core, currentStack.images, initialIndex);

        const onNewImage = (event: Event) => {
          const detail = (event as CustomEvent<{ imageIdIndex: number }>).detail;
          if (typeof detail?.imageIdIndex === "number") {
            sliceIndexRef.current = detail.imageIdIndex;
            setSliceIndex(detail.imageIdIndex);
            setLoadingImageIndex(null);
            prefetchNearbyImages(modules.core, currentStack.images, detail.imageIdIndex);
          }
        };
        viewportElement.addEventListener(core.Enums.Events.STACK_NEW_IMAGE, onNewImage);
        removeListener = () => {
          viewportElement.removeEventListener(core.Enums.Events.STACK_NEW_IMAGE, onNewImage);
        };
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not initialize viewer");
      }
    }

    loadStack();

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [activeStack, applyToolMode, toolMode]);

  useEffect(() => {
    const element = viewportElementRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      renderingEngineRef.current?.resize(true, false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const currentToolGroupId = toolGroupId.current;
    return () => {
      const modules = modulesRef.current;
      if (modules) {
        modules.tools.ToolGroupManager.destroyToolGroup(currentToolGroupId);
      }
      renderingEngineRef.current?.destroy();
    };
  }, []);

  const showImage = useCallback(
    async (nextIndex: number) => {
      const images = activeStack?.images;
      const count = images?.length ?? 0;
      const viewport = viewportRef.current;
      if (!viewport || !images || count === 0) return;
      const clamped = Math.max(0, Math.min(nextIndex, count - 1));
      if (clamped === sliceIndexRef.current) return;

      const requestId = imageRequestIdRef.current + 1;
      imageRequestIdRef.current = requestId;
      setLoadingImageIndex(clamped);
      setError(null);

      try {
        const imageId = await viewport.setImageIdIndex(clamped);
        if (imageRequestIdRef.current !== requestId) return;
        sliceIndexRef.current = clamped;
        setSliceIndex(clamped);
        setLoadingImageIndex(null);
        viewport.render();

        const modules = modulesRef.current;
        if (modules) prefetchNearbyImages(modules.core, images, clamped);
        return imageId;
      } catch (caught) {
        if (imageRequestIdRef.current !== requestId) return;
        setLoadingImageIndex(null);
        setError(caught instanceof Error ? caught.message : "Could not load image");
      }
    },
    [activeStack],
  );

  useEffect(() => {
    if (!isPlaying || !activeStack?.images.length) return;
    const timer = window.setInterval(() => {
      const count = activeStack.images.length;
      void showImage((sliceIndexRef.current + 1) % count);
    }, 180);
    return () => window.clearInterval(timer);
  }, [activeStack?.images.length, isPlaying, showImage]);

  function resetViewport() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.resetCamera();
    viewport.resetProperties();
    viewport.render();
    setIsInverted(false);
  }

  function toggleInvert() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = !isInverted;
    viewport.setProperties({ invert: next });
    viewport.render();
    setIsInverted(next);
  }

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest("a, button, input, select, textarea") || target.isContentEditable)
    ) {
      return;
    }
    if (!activeStack?.images.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      void showImage(sliceIndexRef.current + 1);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      void showImage(sliceIndexRef.current - 1);
    }
    if (event.key === " ") {
      event.preventDefault();
      setIsPlaying((value) => !value);
    }
  }, [activeStack?.images.length, showImage]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const hasStack = Boolean(activeStack?.images.length);
  const collapseGuardrails = () => {
    setResizableSidebarWidth(0);
    setStackRailOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b0d0f] text-zinc-100">
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]",
          stackRailOpen
            ? "xl:grid-cols-[320px_minmax(0,1fr)_280px]"
            : "xl:grid-cols-[320px_minmax(0,1fr)_44px]",
        )}
      >
        <aside
          className="min-h-0 overflow-y-auto border-b border-white/10 bg-[#11151a] lg:border-r lg:border-b-0"
          data-test-id="dicom-series-panel"
        >
          <div className="space-y-3 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">
                Series
              </h2>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="border-white/15 text-zinc-300">
                  {displaySeries.length}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-zinc-300 hover:bg-white/10"
                  onClick={collapseGuardrails}
                  title="Collapse diagnostics and stack rails"
                  data-test-id="dicom-collapse-guardrails"
                >
                  <PanelLeftClose className="size-4" />
                  Rails
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {displaySeries.map((series) => {
                const selected = selectedSeries?.id === series.id;
                return (
                  <button
                    key={series.id}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      selected
                        ? "border-sky-400/50 bg-sky-400/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
                    )}
                    onClick={() => {
                      setSelectedSeriesId(series.id);
                      setIsPlaying(false);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <ImageIcon className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm font-medium text-zinc-100">
                          {series.label}
                        </div>
                        <div className="mt-1 truncate text-xs text-zinc-500">
                          {series.relativeDirectory}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {series.modality ? (
                        <Badge variant="secondary" className="bg-white/10 text-zinc-200">
                          {series.modality}
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="border-white/15 text-zinc-300">
                        {series.images.length} images
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedBiopsy ? (
              <a
                href={selectedBiopsy.pathologyReportHref}
                className="block rounded-lg border border-emerald-300/35 bg-emerald-300/10 p-3 text-left transition-colors hover:border-emerald-200/60 hover:bg-emerald-300/15"
                data-test-id="dicom-pathology-report-link"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-50">
                  <FileText className="size-4 shrink-0 text-emerald-200" />
                  <span>Pathology report</span>
                </div>
                <div className="mt-2 text-xs leading-5 text-emerald-100/80">
                  {selectedBiopsy.title}
                </div>
                <div className="mt-1 text-xs font-medium text-emerald-100">
                  Open canonical report
                </div>
              </a>
            ) : null}

            {catalog?.root && catalog.series.length > 0 && displaySeries.length === 0 ? (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
                {requestedBiopsy
                  ? "No image series matched this biopsy."
                  : "The catalog only has non-image DICOM objects right now."}
              </div>
            ) : null}

            {!catalog?.root ? (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
                No DICOM catalog was found.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col bg-black">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-[#0d1013] px-3 py-2">
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
              onClick={() =>
                setToolMode((mode) => (mode === "zoom" ? "window" : "zoom"))
              }
            />
            <div className="mx-1 h-6 w-px bg-white/10" />
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-300 hover:bg-white/10"
              onClick={() => void showImage(sliceIndex - 1)}
              disabled={!hasStack || sliceIndex <= 0}
              title="Previous image"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-300 hover:bg-white/10"
              onClick={() => setIsPlaying((value) => !value)}
              disabled={!hasStack}
              title={isPlaying ? "Pause cine" : "Play cine"}
            >
              {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-300 hover:bg-white/10"
              onClick={() => void showImage(sliceIndex + 1)}
              disabled={!hasStack || sliceIndex >= (activeStack?.images.length ?? 1) - 1}
              title="Next image"
            >
              <ChevronRight className="size-4" />
            </Button>
            <div className="mx-1 h-6 w-px bg-white/10" />
            <Button
              variant="ghost"
              size="sm"
              className="text-zinc-300 hover:bg-white/10"
              onClick={toggleInvert}
              disabled={!hasStack}
            >
              Invert
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-300 hover:bg-white/10"
              onClick={resetViewport}
              disabled={!hasStack}
              title="Reset viewport"
            >
              <RotateCcw className="size-4" />
            </Button>
            <div className="min-w-36 flex-1 px-2">
              <input
                className="h-2 w-full accent-emerald-300"
                type="range"
                min={0}
                max={Math.max(0, (activeStack?.images.length ?? 1) - 1)}
                value={loadingImageIndex ?? sliceIndex}
                disabled={!hasStack}
                onChange={(event) => void showImage(Number(event.currentTarget.value))}
              />
            </div>
            <div className="font-mono text-xs text-zinc-400">
              <span data-test-id="dicom-slice-counter">
                {hasStack
                  ? `${(loadingImageIndex ?? sliceIndex) + 1} / ${activeStack?.images.length}`
                  : "0 / 0"}
              </span>
            </div>
            <div className="hidden min-w-0 max-w-64 truncate text-xs text-zinc-500 lg:block xl:hidden">
              {currentImage?.fileName ?? activeStack?.title ?? ""}
            </div>
          </div>

          <div
            className="relative min-h-[420px] flex-1 outline-none"
            onContextMenu={(event) => event.preventDefault()}
            aria-label="DICOM image viewport"
          >
            <div
              ref={viewportElementRef}
              className="absolute inset-0 bg-black"
              data-test-id="dicom-cornerstone-viewport"
              data-testid="dicom-cornerstone-viewport"
            />
            {!hasStack ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center">
                <div className="max-w-sm">
                  <ScanSearch className="mx-auto mb-4 size-10 text-zinc-500" />
                  <div className="text-sm font-medium text-zinc-200">
                    Select a DICOM series.
                  </div>
                </div>
              </div>
            ) : null}
            {loadingImageIndex !== null ? (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 px-6 text-center backdrop-blur-[1px]"
                aria-live="polite"
                data-test-id="dicom-image-loading"
                data-testid="dicom-image-loading"
              >
                <div className="rounded-lg border border-white/10 bg-black/80 px-4 py-3 shadow-lg">
                  <div className="mx-auto mb-3 size-7 animate-spin rounded-full border-2 border-white/20 border-t-emerald-300" />
                  <div className="text-sm font-medium text-zinc-100">
                    Loading image {loadingImageIndex + 1}
                  </div>
                  <div className="mt-1 max-w-56 truncate text-xs text-zinc-400">
                    {loadingImage?.fileName ?? activeStack?.title}
                  </div>
                </div>
              </div>
            ) : null}
            {displayError ? (
              <div className="absolute right-3 bottom-3 max-w-md rounded-lg border border-red-400/30 bg-red-950/80 p-3 text-sm text-red-100 shadow-lg">
                {displayError}
              </div>
            ) : null}
          </div>
        </main>

        {stackRailOpen ? (
          <aside
            className="hidden min-h-0 overflow-y-auto border-t border-white/10 bg-[#11151a] xl:block xl:border-t-0 xl:border-l"
            data-test-id="dicom-stack-panel"
          >
            <div className="space-y-5 p-4">
              <section>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-300 uppercase">
                    <Info className="size-4" />
                    Stack
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-zinc-300 hover:bg-white/10"
                    onClick={() => setStackRailOpen(false)}
                    title="Collapse stack rail"
                    aria-label="Collapse stack rail"
                    aria-pressed={stackRailOpen}
                    data-test-id="dicom-toggle-stack-rail"
                  >
                    <PanelRightClose className="size-4" />
                  </Button>
                </div>
                <dl className="space-y-3 text-sm">
                  <MetaRow label="Title" value={activeStack?.title} />
                  <MetaRow label="Source" value={activeStack?.source} />
                  <MetaRow label="Date" value={activeStack?.studyDate} />
                  <MetaRow label="Modality" value={activeStack?.modality} />
                  <MetaRow label="Directory" value={activeStack?.directory} />
                </dl>
              </section>

              <section>
                <div className="mb-3 text-xs font-semibold tracking-wide text-zinc-300 uppercase">
                  Current Image
                </div>
                <dl className="space-y-3 text-sm">
                  <MetaRow label="File" value={currentImage?.fileName} />
                  <MetaRow label="Instance" value={currentImage?.instanceNumber?.toString()} />
                  <MetaRow label="Dimensions" value={currentImage?.dimensions} />
                  <MetaRow
                    label="Size"
                    value={
                      currentImage?.byteLength
                        ? formatBytes(currentImage.byteLength)
                        : undefined
                    }
                  />
                </dl>
                <div className="mt-3 break-all rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-[11px] text-zinc-500">
                  {currentImage?.relativePath ?? "No image selected"}
                </div>
              </section>

              <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-zinc-400">
                <div className="font-medium text-zinc-200">Mouse</div>
                <div>Left drag uses the selected tool.</div>
                <div>Right drag pans. Middle drag zooms. Wheel scrolls slices.</div>
                <div className="mt-2 font-medium text-zinc-200">Keyboard</div>
                <div>Arrow keys step through images. Space toggles cine.</div>
              </section>
            </div>
          </aside>
        ) : (
          <div className="hidden min-h-0 border-l border-white/10 bg-[#11151a] xl:flex xl:items-start xl:justify-center xl:pt-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-zinc-300 hover:bg-white/10"
              onClick={() => setStackRailOpen(true)}
              title="Open stack rail"
              aria-label="Open stack rail"
              aria-pressed={stackRailOpen}
              data-test-id="dicom-toggle-stack-rail"
            >
              <PanelRightOpen className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
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
      {label}
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

function isRenderableSeries(series: DicomSeries) {
  return !new Set(["PR", "SR", "OT"]).has((series.modality ?? "").toUpperCase());
}

function matchesBiopsySeries(series: DicomSeries, biopsy: DiagnosticBiopsy) {
  return (
    series.studyDate === biopsy.isoDate &&
    series.relativeDirectory
      .toLowerCase()
      .includes(biopsy.directoryIncludes.toLowerCase()) &&
    isRenderableSeries(series)
  );
}

function findBiopsyForSeries(series: DicomSeries | null) {
  if (!series) return null;
  return (
    DIAGNOSTIC_BIOPSIES.find((biopsy) => matchesBiopsySeries(series, biopsy)) ?? null
  );
}

function findSeriesForBiopsy(series: DicomSeries[], biopsyId: string | null | undefined) {
  const biopsy = getDiagnosticBiopsyById(biopsyId);
  if (!biopsy) return null;

  return (
    series
      .filter((candidate) => matchesBiopsySeries(candidate, biopsy))
      .sort((a, b) => b.images.length - a.images.length)[0] ?? null
  );
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
        // Prefetch is opportunistic; normal navigation still reports load errors.
      });
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
