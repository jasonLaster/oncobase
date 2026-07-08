"use client";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
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
  Share2,
  SlidersHorizontal,
  X,
  ZoomIn,
} from "lucide-react";
import useSWR from "swr";

import { copyTextToClipboard } from "@oncobase/wiki-shell";
import { Badge, Button, cn, setResizableSidebarWidth } from "./ui";
import {
  DIAGNOSTIC_STUDY_SET_PARAM,
  getPrimaryReportLink,
  type DiagnosticStudiesPayload,
  type DiagnosticStudy,
} from "../studies";
import { DicomAnnotationLayer } from "./dicom-annotation-layer";

type CornerstoneCore = typeof import("@cornerstonejs/core");
type CornerstoneTools = typeof import("@cornerstonejs/tools");
type DicomImageLoader = typeof import("@cornerstonejs/dicom-image-loader");

type ToolMode = "window" | "pan" | "zoom";
type DicomRail = "series" | "stack";

const DICOM_SERIES_RAIL_MIN_WIDTH = 240;
const DICOM_SERIES_RAIL_MAX_WIDTH = 460;
const DICOM_SERIES_RAIL_DEFAULT_WIDTH = 320;
const DICOM_STACK_RAIL_MIN_WIDTH = 220;
const DICOM_STACK_RAIL_MAX_WIDTH = 420;
const DICOM_STACK_RAIL_DEFAULT_WIDTH = 280;
const DICOM_STACK_RAIL_COLLAPSED_WIDTH = 44;
const DICOM_RAIL_WIDTH_STEP = 16;

const DICOM_RAIL_STORAGE_KEYS: Record<DicomRail, string> = {
  series: "dicom-viewer-series-rail-width",
  stack: "dicom-viewer-stack-rail-width",
};

interface DicomRailBounds {
  min: number;
  max: number;
  defaultWidth: number;
}

interface DicomRailResizeState {
  rail: DicomRail;
  startX: number;
  startWidth: number;
}

interface DicomCatalog {
  root: string | null;
  rootsTried: string[];
  series: DicomSeries[];
}

interface DicomSeries {
  id: string;
  seriesKey?: string;
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

async function fetchDiagnosticStudies(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Diagnostic studies request failed: ${response.status}`);
  return (await response.json()) as DiagnosticStudiesPayload;
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

function dicomRailBounds(rail: DicomRail): DicomRailBounds {
  if (rail === "series") {
    return {
      min: DICOM_SERIES_RAIL_MIN_WIDTH,
      max: DICOM_SERIES_RAIL_MAX_WIDTH,
      defaultWidth: DICOM_SERIES_RAIL_DEFAULT_WIDTH,
    };
  }

  return {
    min: DICOM_STACK_RAIL_MIN_WIDTH,
    max: DICOM_STACK_RAIL_MAX_WIDTH,
    defaultWidth: DICOM_STACK_RAIL_DEFAULT_WIDTH,
  };
}

function clampDicomRailWidth(rail: DicomRail, width: number) {
  const bounds = dicomRailBounds(rail);
  return Math.min(bounds.max, Math.max(bounds.min, width));
}

function readStoredDicomRailWidth(rail: DicomRail) {
  const bounds = dicomRailBounds(rail);
  if (typeof window === "undefined") return bounds.defaultWidth;

  const stored = window.localStorage.getItem(DICOM_RAIL_STORAGE_KEYS[rail]);
  if (!stored) return bounds.defaultWidth;

  const width = Number.parseInt(stored, 10);
  if (!Number.isFinite(width)) return bounds.defaultWidth;
  return clampDicomRailWidth(rail, width);
}

function readInitialSearchParam(name: string) {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(name);
}

function readInitialImageIndexFromLocation() {
  const value = readInitialSearchParam("image") ?? readInitialSearchParam("slice");
  if (!value) return null;
  const imageNumber = Number.parseInt(value, 10);
  return Number.isFinite(imageNumber) && imageNumber > 0 ? imageNumber - 1 : null;
}

function persistDicomRailWidth(rail: DicomRail, width: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DICOM_RAIL_STORAGE_KEYS[rail], String(width));
}

function nextDicomRailWidth(state: DicomRailResizeState, clientX: number) {
  const delta = clientX - state.startX;
  const directedDelta = state.rail === "series" ? delta : -delta;
  return clampDicomRailWidth(state.rail, state.startWidth + directedDelta);
}

interface DicomViewerClientProps {
  initialBiopsyId?: string | null;
  initialImageNumber?: number | null;
  initialSeriesId?: string | null;
  initialStudySet?: string | null;
}

export function DicomViewerClient({
  initialBiopsyId = null,
  initialImageNumber = null,
  initialSeriesId = null,
  initialStudySet = null,
}: DicomViewerClientProps) {
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const renderingEngineRef = useRef<InstanceType<CornerstoneCore["RenderingEngine"]> | null>(
    null,
  );
  const viewportRef = useRef<InstanceType<CornerstoneCore["StackViewport"]> | null>(null);
  const modulesRef = useRef<CornerstoneModules | null>(null);
  const sliceIndexRef = useRef(0);
  const imageRequestIdRef = useRef(0);
  const initialImageIndexRef = useRef(
    initialImageNumber !== null
      ? Math.max(0, initialImageNumber - 1)
      : readInitialImageIndexFromLocation(),
  );
  const toolModeRef = useRef<ToolMode>("window");
  const railResizeRef = useRef<DicomRailResizeState | null>(null);

  const renderingEngineId = useRef(`oncobase-dicom-engine-${crypto.randomUUID()}`);
  const viewportId = useRef(`oncobase-dicom-viewport-${crypto.randomUUID()}`);
  const toolGroupId = useRef(`oncobase-dicom-tools-${crypto.randomUUID()}`);

  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(
    () => initialSeriesId ?? readInitialSearchParam("seriesId"),
  );
  const [sliceIndex, setSliceIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>("window");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isInverted, setIsInverted] = useState(false);
  const [loadingImageIndex, setLoadingImageIndex] = useState<number | null>(null);
  const [loadedStackId, setLoadedStackId] = useState<string | null>(null);
  const [shareState, setShareState] = useState<"idle" | "copied" | "error">("idle");
  const [stackRailOpen, setStackRailOpen] = useState(true);
  const [seriesRailWidth, setSeriesRailWidth] = useState(() =>
    readStoredDicomRailWidth("series"),
  );
  const [stackRailWidth, setStackRailWidth] = useState(() =>
    readStoredDicomRailWidth("stack"),
  );
  const [annotationEditorOpen, setAnnotationEditorOpen] = useState(false);
  const [annotationEditorPortalElement, setAnnotationEditorPortalElement] =
    useState<HTMLDivElement | null>(null);
  const [mobileStudySheetOpen, setMobileStudySheetOpen] = useState(false);
  const [mobileStudyTab, setMobileStudyTab] = useState<"series" | "report">("series");
  const {
    data: catalog,
    error: catalogError,
  } = useSWR<DicomCatalog>("/api/dicom/studies", fetchDicomCatalog, {
    revalidateOnFocus: false,
  });
  const diagnosticStudiesUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (initialStudySet) params.set(DIAGNOSTIC_STUDY_SET_PARAM, initialStudySet);
    const query = params.toString();
    return `/api/diagnostic-studies${query ? `?${query}` : ""}`;
  }, [initialStudySet]);
  const { data: diagnosticStudiesPayload } = useSWR<DiagnosticStudiesPayload>(
    diagnosticStudiesUrl,
    fetchDiagnosticStudies,
    {
      revalidateOnFocus: false,
    },
  );
  const diagnosticStudies = useMemo(
    () => diagnosticStudiesPayload?.studies ?? [],
    [diagnosticStudiesPayload],
  );

  const renderableSeries = useMemo(
    () => catalog?.series.filter(isRenderableSeries) ?? [],
    [catalog],
  );

  const requestedBiopsy = useMemo(
    () => diagnosticStudies.find((study) => study.id === initialBiopsyId) ?? null,
    [diagnosticStudies, initialBiopsyId],
  );

  const displaySeries = useMemo(
    () =>
      requestedBiopsy
        ? renderableSeries.filter((series) => matchesBiopsySeries(series, requestedBiopsy))
        : renderableSeries,
    [renderableSeries, requestedBiopsy],
  );

  const preferredSeriesId = useMemo(() => {
    const requestedBiopsySeries = findSeriesForBiopsy(
      displaySeries,
      initialBiopsyId,
      diagnosticStudies,
    );
    const preferred =
      requestedBiopsySeries ??
      findSeriesForBiopsy(renderableSeries, "biopsy-2026-04-10", diagnosticStudies) ??
      renderableSeries[0];
    return preferred?.id ?? null;
  }, [diagnosticStudies, displaySeries, initialBiopsyId, renderableSeries]);

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
    () => findBiopsyForSeries(selectedSeries, diagnosticStudies) ?? requestedBiopsy,
    [diagnosticStudies, requestedBiopsy, selectedSeries],
  );
  const selectedReportLink = selectedBiopsy
    ? getPrimaryReportLink(selectedBiopsy)
    : null;

  const activeStack = useMemo<ActiveStack | null>(() => {
    if (!selectedSeries) return null;

    return {
      id: selectedSeries.seriesKey ?? selectedSeries.id,
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
  const activeStackId = activeStack?.id ?? null;
  const activeStackImageCount = activeStack?.images.length ?? 0;
  const activeStackLoaded = Boolean(
    activeStackId && activeStackImageCount > 0 && loadedStackId === activeStackId,
  );
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
    const initialImageIndex = readInitialImageIndexFromLocation();
    if (initialImageIndexRef.current === null && initialImageIndex !== null) {
      initialImageIndexRef.current = initialImageIndex;
    }
  }, []);

  useEffect(() => {
    toolModeRef.current = toolMode;
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
      setLoadedStackId(null);
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

        applyToolMode(toolModeRef.current);

        const viewport = renderingEngine.getViewport(
          viewportId.current,
        ) as InstanceType<CornerstoneCore["StackViewport"]>;
        viewportRef.current = viewport;

        const imageIds = currentStack.images.map((image) => image.imageId);
        const requestedInitialIndex =
          initialImageIndexRef.current ?? readInitialImageIndexFromLocation();
        const initialIndex =
          requestedInitialIndex !== null
            ? clampImageIndex(requestedInitialIndex, imageIds.length)
            : imageIds.length > 1
              ? Math.floor(imageIds.length / 2)
              : 0;
        await waitForElementSize(viewportElement);
        setLoadingImageIndex(initialIndex);
        await viewport.setStack(imageIds, initialIndex);
        if (cancelled) return;

        renderingEngine.resize(true, false);
        viewport.resetCamera();
        viewport.resetProperties();
        viewport.render();
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          renderingEngine.resize(true, true);
          viewport.render();
        });

        setSliceIndex(initialIndex);
        sliceIndexRef.current = initialIndex;
        setLoadingImageIndex(null);
        setLoadedStackId(currentStack.id);
        initialImageIndexRef.current = null;
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
  }, [activeStack, applyToolMode]);

  useEffect(() => {
    const element = viewportElementRef.current;
    if (!element) return;

    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        renderingEngineRef.current?.resize(true, true);
        viewportRef.current?.render();
      });
    });
    observer.observe(element);
    return () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
    };
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
    if (!activeStackLoaded || !activeStackId) return;
    const nextUrl = currentImageShareUrl(activeStackId, sliceIndex);
    if (nextUrl !== window.location.href) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [activeStackId, activeStackLoaded, sliceIndex]);

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

  const setDicomRailWidth = useCallback(
    (rail: DicomRail, width: number, options?: { persist?: boolean }) => {
      const next = clampDicomRailWidth(rail, width);
      if (rail === "series") {
        setSeriesRailWidth(next);
      } else {
        setStackRailWidth(next);
      }
      if (options?.persist ?? true) {
        persistDicomRailWidth(rail, next);
      }
      return next;
    },
    [],
  );

  const beginRailResize = useCallback(
    (rail: DicomRail, event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      railResizeRef.current = {
        rail,
        startX: event.clientX,
        startWidth: rail === "series" ? seriesRailWidth : stackRailWidth,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [seriesRailWidth, stackRailWidth],
  );

  const resizeRail = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const state = railResizeRef.current;
      if (!state) return;
      event.preventDefault();
      setDicomRailWidth(state.rail, nextDicomRailWidth(state, event.clientX), {
        persist: false,
      });
    },
    [setDicomRailWidth],
  );

  const endRailResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const state = railResizeRef.current;
      if (!state) return;
      event.preventDefault();
      setDicomRailWidth(state.rail, nextDicomRailWidth(state, event.clientX));
      railResizeRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [setDicomRailWidth],
  );

  const nudgeRailWidth = useCallback(
    (rail: DicomRail, event: ReactKeyboardEvent<HTMLDivElement>) => {
      const bounds = dicomRailBounds(rail);
      const currentWidth = rail === "series" ? seriesRailWidth : stackRailWidth;
      const step = event.shiftKey ? DICOM_RAIL_WIDTH_STEP * 2 : DICOM_RAIL_WIDTH_STEP;
      let nextWidth: number | null = null;

      if (event.key === "ArrowLeft") nextWidth = currentWidth - step;
      if (event.key === "ArrowRight") nextWidth = currentWidth + step;
      if (event.key === "Home") nextWidth = bounds.min;
      if (event.key === "End") nextWidth = bounds.max;
      if (nextWidth === null) return;

      event.preventDefault();
      event.stopPropagation();
      setDicomRailWidth(rail, nextWidth);
    },
    [seriesRailWidth, setDicomRailWidth, stackRailWidth],
  );

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest("a, button, input, select, textarea, [role='separator']") ||
        target.isContentEditable)
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

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px), (max-height: 560px)");
    const syncCompactLayout = () => {
      if (query.matches) {
        setStackRailOpen(false);
      }
    };

    syncCompactLayout();
    query.addEventListener("change", syncCompactLayout);
    return () => query.removeEventListener("change", syncCompactLayout);
  }, []);

  const hasStack = Boolean(activeStack?.images.length);
  const selectSeries = useCallback((seriesId: string, closeMobileSheet = false) => {
    setSelectedSeriesId(seriesId);
    setIsPlaying(false);
    if (closeMobileSheet) setMobileStudySheetOpen(false);
  }, []);
  const openMobileStudySheet = useCallback((tab: "series" | "report" = "series") => {
    setMobileStudyTab(tab);
    setMobileStudySheetOpen(true);
  }, []);
  const handleAnnotationEditorOpenChange = useCallback((open: boolean) => {
    setAnnotationEditorOpen(open);
    if (open) setStackRailOpen(true);
  }, []);
  const setAnnotationEditorRailNode = useCallback((node: HTMLDivElement | null) => {
    setAnnotationEditorPortalElement(node);
  }, []);
  const collapseGuardrails = () => {
    setResizableSidebarWidth(0);
    setStackRailOpen(false);
  };
  const shareCurrentImage = useCallback(async () => {
    if (!activeStackLoaded || !activeStackId) return;
    const shareUrl = currentImageShareUrl(activeStackId, sliceIndex);
    try {
      await copyTextToClipboard(shareUrl);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1600);
    } catch {
      setShareState("error");
      window.setTimeout(() => setShareState("idle"), 2200);
    }
  }, [activeStackId, activeStackLoaded, sliceIndex]);
  const viewerLayoutStyle = useMemo(
    () =>
      ({
        "--dicom-series-rail-width": `${seriesRailWidth}px`,
        "--dicom-stack-rail-column-width": `${
          stackRailOpen ? stackRailWidth : DICOM_STACK_RAIL_COLLAPSED_WIDTH
        }px`,
      }) as CSSProperties,
    [seriesRailWidth, stackRailOpen, stackRailWidth],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b0d0f] text-zinc-100">
      <div
        className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[var(--dicom-series-rail-width,300px)_minmax(0,1fr)] xl:grid-cols-[var(--dicom-series-rail-width,320px)_minmax(0,1fr)_var(--dicom-stack-rail-column-width,280px)]"
        style={viewerLayoutStyle}
        data-dicom-viewer-layout
      >
        <aside
          className="relative hidden min-h-0 border-r border-white/10 bg-[#11151a] lg:block"
          data-test-id="dicom-series-panel"
        >
          <div className="h-full min-h-0 overflow-y-auto">
            <div className="space-y-3 p-2.5 sm:p-3">
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

              <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
                {displaySeries.map((series) => {
                  const selected = selectedSeries?.id === series.id;
                  return (
                    <button
                      key={series.id}
                      className={cn(
                        "w-64 shrink-0 rounded-lg border p-2.5 text-left transition-colors sm:w-72 lg:w-full lg:p-3",
                        selected
                          ? "border-sky-400/50 bg-sky-400/10"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
                      )}
                      onClick={() => {
                        selectSeries(series.id);
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <ImageIcon className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm font-medium text-zinc-100">
                            {formatSeriesCardLabel(series)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          className="border-white/15 text-zinc-300"
                        >
                          {series.images.length} images
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedReportLink && selectedBiopsy ? (
                <a
                  href={selectedReportLink.href}
                  className="block w-64 shrink-0 rounded-lg border border-emerald-300/35 bg-emerald-300/10 p-3 text-left transition-colors hover:border-emerald-200/60 hover:bg-emerald-300/15 sm:w-72 lg:w-auto"
                  data-test-id="dicom-pathology-report-link"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-50">
                    <FileText className="size-4 shrink-0 text-emerald-200" />
                    <span>{selectedReportLink.label}</span>
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
          </div>
          <DicomRailResizeHandle
            rail="series"
            label="Resize series rail"
            value={seriesRailWidth}
            min={DICOM_SERIES_RAIL_MIN_WIDTH}
            max={DICOM_SERIES_RAIL_MAX_WIDTH}
            onPointerDown={beginRailResize}
            onPointerMove={resizeRail}
            onPointerUp={endRailResize}
            onKeyDown={nudgeRailWidth}
          />
        </aside>

        <main className="flex min-h-0 flex-col bg-black">
          <div
            className="relative min-h-[260px] flex-1 touch-none outline-none select-none sm:min-h-[420px] max-lg:landscape:min-h-0"
            onContextMenu={(event) => event.preventDefault()}
            aria-label="DICOM image viewport"
            data-test-id="dicom-viewport-frame"
          >
            <div
              ref={viewportElementRef}
              className="absolute inset-0 touch-none bg-black select-none"
              data-test-id="dicom-cornerstone-viewport"
              data-testid="dicom-cornerstone-viewport"
            />
            <Button
              variant="outline"
              size="icon"
              className="absolute top-3 right-3 z-10 border-white/15 bg-black/70 text-zinc-100 shadow-lg backdrop-blur hover:bg-black/85"
              onClick={shareCurrentImage}
              disabled={!activeStackLoaded}
              title={
                shareState === "copied"
                  ? "Copied current image URL"
                  : shareState === "error"
                    ? "Unable to copy current image URL"
                    : "Copy current image URL"
              }
              aria-label={
                shareState === "copied"
                  ? "Copied current image URL"
                  : "Copy current image URL"
              }
              data-test-id="dicom-share-current-image"
            >
              {shareState === "copied" ? (
                <Check className="size-4" />
              ) : (
                <Share2 className="size-4" />
              )}
            </Button>
            <DicomAnnotationLayer
              currentImage={currentImage}
              disabled={!hasStack || loadingImageIndex !== null}
              editorPortalElement={annotationEditorPortalElement}
              onEditorOpenChange={handleAnnotationEditorOpenChange}
              series={activeStack}
            />
            {!catalog && !displayError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center">
                <div className="max-w-sm">
                  <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-white/15 border-t-emerald-300" />
                  <div className="text-sm font-medium text-zinc-200">
                    Loading DICOM catalog.
                  </div>
                </div>
              </div>
            ) : !hasStack ? (
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

          <div
            className="flex shrink-0 flex-col gap-1 border-t border-white/10 bg-[#0d1013] px-2 py-1.5 sm:px-3 sm:py-2 lg:flex-row lg:items-center lg:gap-2 max-lg:order-first max-lg:border-t-0 max-lg:border-b max-lg:landscape:flex-row max-lg:landscape:items-center max-lg:landscape:gap-1.5"
            data-test-id="dicom-controls"
          >
            <div
              className="flex shrink-0 items-center gap-1 overflow-x-auto"
              data-test-id="dicom-tools-row"
            >
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
                onClick={() =>
                  setToolMode((mode) => (mode === "pan" ? "window" : "pan"))
                }
              />
              <ToolButton
                active={toolMode === "zoom"}
                icon={<ZoomIn className="size-4" />}
                label="Zoom"
                onClick={() =>
                  setToolMode((mode) => (mode === "zoom" ? "window" : "zoom"))
                }
              />
              <Button
                variant="outline"
                size="sm"
                className="border-white/15 bg-white/5 px-2 text-zinc-300 hover:bg-white/10 sm:px-3"
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
            </div>

            <div
              className="flex min-w-0 flex-1 items-center gap-1"
              data-test-id="dicom-cine-row"
            >
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-zinc-300 hover:bg-white/10"
                onClick={() => void showImage(sliceIndex - 1)}
                disabled={!hasStack || sliceIndex <= 0}
                title="Previous image"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-zinc-300 hover:bg-white/10"
                onClick={() => setIsPlaying((value) => !value)}
                disabled={!hasStack}
                title={isPlaying ? "Pause cine" : "Play cine"}
              >
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-zinc-300 hover:bg-white/10"
                onClick={() => void showImage(sliceIndex + 1)}
                disabled={!hasStack || sliceIndex >= (activeStack?.images.length ?? 1) - 1}
                title="Next image"
              >
                <ChevronRight className="size-4" />
              </Button>
              <div className="min-w-24 flex-1 px-1 sm:min-w-36 sm:px-2">
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
              <div className="shrink-0 font-mono text-xs text-zinc-400">
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
          </div>
        </main>

        {stackRailOpen ? (
          <aside
            className="relative hidden min-h-0 border-t border-white/10 bg-[#11151a] xl:block xl:border-t-0 xl:border-l"
            data-test-id="dicom-stack-panel"
          >
            <div className="h-full min-h-0 overflow-y-auto">
              <div className="space-y-5 p-4">
                {annotationEditorOpen ? (
                  <section data-test-id="dicom-annotation-editor-rail">
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-300 uppercase">
                        <SlidersHorizontal className="size-4" />
                        Edit
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-zinc-300 hover:bg-white/10"
                        onClick={() => setStackRailOpen(false)}
                        title="Collapse editor rail"
                        aria-label="Collapse editor rail"
                        aria-pressed={stackRailOpen}
                        data-test-id="dicom-toggle-stack-rail"
                      >
                        <PanelRightClose className="size-4" />
                      </Button>
                    </div>
                    <div ref={setAnnotationEditorRailNode} />
                  </section>
                ) : (
                  <>
                    <section data-test-id="dicom-stack-metadata">
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
                        <MetaRow
                          label="Instance"
                          value={currentImage?.instanceNumber?.toString()}
                        />
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
                      <div className="mt-2 font-medium text-zinc-200">Touch</div>
                      <div>One-finger drag uses the selected tool.</div>
                      <div>Two-finger pinch or drag zooms and pans.</div>
                      <div className="mt-2 font-medium text-zinc-200">Keyboard</div>
                      <div>Arrow keys step through images. Space toggles cine.</div>
                    </section>
                  </>
                )}
              </div>
            </div>
            <DicomRailResizeHandle
              rail="stack"
              label="Resize stack rail"
              value={stackRailWidth}
              min={DICOM_STACK_RAIL_MIN_WIDTH}
              max={DICOM_STACK_RAIL_MAX_WIDTH}
              onPointerDown={beginRailResize}
              onPointerMove={resizeRail}
              onPointerUp={endRailResize}
              onKeyDown={nudgeRailWidth}
            />
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

      <button
        type="button"
        className="flex shrink-0 items-center gap-3 border-t border-white/10 bg-[#11151a] px-3 pt-2 pb-2 text-left text-zinc-100 lg:hidden"
        style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
        onClick={() => openMobileStudySheet()}
        data-test-id="dicom-mobile-series-bar"
      >
        <ImageIcon className="size-4 shrink-0 text-zinc-400" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {selectedSeries?.label ?? "Select a DICOM series"}
          </span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">
            {hasStack
              ? `${activeStack?.images.length ?? 0} images`
              : `${displaySeries.length} available series`}
            {selectedBiopsy ? ` · ${selectedBiopsy.title}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-emerald-100">
          Series
        </span>
      </button>

      <div
        className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 lg:hidden",
          mobileStudySheetOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
        data-state={mobileStudySheetOpen ? "open" : "closed"}
        data-test-id="dicom-mobile-study-sheet"
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          onClick={() => setMobileStudySheetOpen(false)}
        />
        <div
          className={cn(
            "absolute right-0 bottom-0 left-0 flex h-[min(82dvh,36rem)] flex-col rounded-t-2xl border-t border-white/10 bg-[#11151a] shadow-2xl transition-transform duration-300 ease-out",
            mobileStudySheetOpen ? "translate-y-0" : "translate-y-full",
          )}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="shrink-0 px-4 pt-2 pb-3">
            <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-zinc-500/50" />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-100">
                  {selectedBiopsy?.title ?? activeStack?.title ?? "DICOM study"}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {displaySeries.length} series
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-zinc-300 hover:bg-white/10"
                onClick={() => setMobileStudySheetOpen(false)}
                aria-label="Close study navigation"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="mt-3 flex rounded-md border border-white/10 bg-black/30 p-0.5">
              <button
                type="button"
                onClick={() => setMobileStudyTab("series")}
                className={cn(
                  "flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                  mobileStudyTab === "series"
                    ? "bg-emerald-300/15 text-emerald-100"
                    : "text-zinc-400 hover:text-zinc-100",
                )}
              >
                Series
              </button>
              <button
                type="button"
                onClick={() => setMobileStudyTab("report")}
                className={cn(
                  "flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                  mobileStudyTab === "report"
                    ? "bg-emerald-300/15 text-emerald-100"
                    : "text-zinc-400 hover:text-zinc-100",
                )}
              >
                Report
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
            {mobileStudyTab === "series" ? (
              <div
                className="-mx-3 divide-y divide-white/10"
                data-test-id="dicom-mobile-series-list"
              >
                {displaySeries.map((series) => {
                  const selected = selectedSeries?.id === series.id;
                  return (
                    <button
                      key={series.id}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                        selected ? "bg-sky-400/10" : "hover:bg-white/[0.06]",
                      )}
                      onClick={() => selectSeries(series.id, true)}
                    >
                      <span
                        className={cn(
                          "h-10 w-0.5 shrink-0 rounded-full bg-transparent",
                          selected && "bg-sky-300",
                        )}
                        aria-hidden="true"
                      />
                      <ImageIcon className="size-4 shrink-0 text-zinc-500" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium text-zinc-100">
                          {formatSeriesCardLabel(series)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-zinc-400">
                        <span className="block text-zinc-300">
                          {series.images.length}
                        </span>
                        <span className="block">images</span>
                      </span>
                    </button>
                  );
                })}
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
            ) : selectedReportLink && selectedBiopsy ? (
              <a
                href={selectedReportLink.href}
                className="block rounded-lg border border-emerald-300/35 bg-emerald-300/10 p-3 text-left transition-colors hover:border-emerald-200/60 hover:bg-emerald-300/15"
                data-test-id="dicom-mobile-pathology-report-link"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-50">
                  <FileText className="size-4 shrink-0 text-emerald-200" />
                  <span>{selectedReportLink.label}</span>
                </div>
                <div className="mt-2 text-xs leading-5 text-emerald-100/80">
                  {selectedBiopsy.title}
                </div>
                <div className="mt-1 text-xs font-medium text-emerald-100">
                  Open canonical report
                </div>
              </a>
            ) : (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-300">
                No pathology report is linked to the selected series.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DicomRailResizeHandle({
  rail,
  label,
  value,
  min,
  max,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  rail: DicomRail;
  label: string;
  value: number;
  min: number;
  max: number;
  onPointerDown: (rail: DicomRail, event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (rail: DicomRail, event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      data-test-id={`dicom-${rail}-rail-resize-handle`}
      className={cn(
        "group absolute top-0 bottom-0 z-20 hidden w-3 cursor-col-resize touch-none justify-center outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70",
        rail === "series" ? "-right-1.5 lg:flex" : "-left-1.5 xl:flex",
      )}
      onPointerDown={(event) => onPointerDown(rail, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => onKeyDown(rail, event)}
    >
      <span className="my-3 w-px flex-1 rounded-full bg-white/15 transition-colors group-hover:bg-emerald-300/70 group-focus-visible:bg-emerald-300" />
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

function isRenderableSeries(series: DicomSeries) {
  return !new Set(["PR", "SR", "OT"]).has((series.modality ?? "").toUpperCase());
}

function formatSeriesCardLabel(series: DicomSeries) {
  const description = series.seriesDescription ?? series.studyDescription ?? series.label;
  const seriesNumber = series.seriesNumber ? `Series ${series.seriesNumber}` : null;
  if (!seriesNumber || description.toLowerCase().includes(seriesNumber.toLowerCase())) {
    return description;
  }
  return `${description} · ${seriesNumber}`;
}

function matchesBiopsySeries(series: DicomSeries, biopsy: DiagnosticStudy) {
  return (
    series.studyDate === biopsy.isoDate &&
    series.relativeDirectory
      .toLowerCase()
      .includes(biopsy.directoryIncludes.toLowerCase()) &&
    isRenderableSeries(series)
  );
}

function findBiopsyForSeries(
  series: DicomSeries | null,
  diagnosticStudies: DiagnosticStudy[],
) {
  if (!series) return null;
  return (
    diagnosticStudies.find((biopsy) => matchesBiopsySeries(series, biopsy)) ?? null
  );
}

function findSeriesForBiopsy(
  series: DicomSeries[],
  biopsyId: string | null | undefined,
  diagnosticStudies: DiagnosticStudy[],
) {
  const biopsy = diagnosticStudies.find((study) => study.id === biopsyId) ?? null;
  if (!biopsy) return null;

  return (
    series
      .filter((candidate) => matchesBiopsySeries(candidate, biopsy))
      .sort((a, b) => b.images.length - a.images.length)[0] ?? null
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

function clampImageIndex(index: number, imageCount: number) {
  if (imageCount <= 0) return 0;
  return Math.max(0, Math.min(index, imageCount - 1));
}

function currentImageShareUrl(seriesId: string, imageIndex: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("seriesId", seriesId);
  url.searchParams.set("image", String(imageIndex + 1));
  url.searchParams.delete("slice");
  return url.toString();
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
