import { safeLocalStorage } from "@oncobase/safe-storage";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@oncobase/ui/resizable";
import {
  SIDEBAR_DEFAULT_WIDTH as DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH as MAX_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY as STORAGE_KEY,
  SIDEBAR_WIDTH_VARIABLE,
} from "./sidebar-startup.ts";

const MIN_WIDTH = 160;

let listeners: Array<() => void> = [];
let widthCache: number | null = null;

function readStoredWidth() {
  if (typeof window === "undefined") return DEFAULT_WIDTH;

  const stored = safeLocalStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_WIDTH;

  const width = Number.parseInt(stored, 10);
  if (!Number.isFinite(width) || width < 0 || width > MAX_WIDTH) {
    return DEFAULT_WIDTH;
  }
  return width;
}

function syncSidebarState(width: number) {
  if (typeof window === "undefined") return;
  const root = window.document.documentElement;
  root.dataset.initialSidebarState = width === 0 ? "collapsed" : "expanded";
  // Collapsed keeps the last width, so expanding restores it.
  if (width > 0) root.style.setProperty(SIDEBAR_WIDTH_VARIABLE, `${width}px`);
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  listeners.push(onStoreChange);

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    widthCache = null;
    syncSidebarState(readStoredWidth());
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((listener) => listener !== onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function getWidthSnapshot() {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  if (widthCache != null) return widthCache;
  widthCache = readStoredWidth();
  return widthCache;
}

export function setResizableSidebarWidth(
  nextWidth: number,
  options?: { persist?: boolean },
) {
  if (typeof window === "undefined") return;

  widthCache = nextWidth;
  syncSidebarState(nextWidth);

  if (options?.persist ?? true) {
    safeLocalStorage.setItem(STORAGE_KEY, String(nextWidth));
  }

  listeners.forEach((listener) => listener());
}

export function useResizableSidebarWidth() {
  return useSyncExternalStore(subscribe, getWidthSnapshot, () => DEFAULT_WIDTH);
}

type ResizableController = ReturnType<typeof createResizableController>;

/**
 * Keeps a panel at a width in pixels. Group sizes are shares, so the group
 * rescales the panel with the window; this applies the width once the group
 * has attached its panels, whenever the group's width changes, and when the
 * width does. Returns whether it has applied: until then, size the panel
 * from CSS (the group first renders at its default size).
 */
export function usePanelPixelWidth(
  controller: ResizableController,
  groupRef: RefObject<HTMLElement | null>,
  panelId: string,
  width: number | null,
) {
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    const group = groupRef.current;
    if (!group || width === null) {
      setApplied(false);
      return;
    }
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      if (controller.getLayout().length === 0) {
        frame = requestAnimationFrame(apply);
        return;
      }
      controller.resize(panelId, `${width}px`);
      setApplied(true);
    };
    apply();
    let groupWidth = group.clientWidth;
    const observer = new ResizeObserver(() => {
      if (group.clientWidth === groupWidth) return;
      groupWidth = group.clientWidth;
      // After the group has rescaled its shares for the new width.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    observer.observe(group);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [controller, groupRef, panelId, width]);
  return applied;
}

export type ResizableLayoutProps = {
  children: ReactNode;
  sidebar: ReactNode;
};

const SIDEBAR_PANEL_ID = "wiki-sidebar-panel";

export function ResizableLayout({ children, sidebar }: ResizableLayoutProps) {
  const width = useResizableSidebarWidth();
  const collapsed = width === 0;
  const [controller] = useState(createResizableController);
  const groupRef = useRef<HTMLDivElement>(null);

  // Until the saved width is applied, styles.css sizes the panel from the
  // variable sidebar-startup.ts writes before the first paint.
  const widthApplied = usePanelPixelWidth(controller, groupRef, SIDEBAR_PANEL_ID, collapsed ? null : width);

  // A document without the startup script still gets the saved width before paint.
  useLayoutEffect(() => { syncSidebarState(getWidthSnapshot()); }, []);

  const toggle = () => setResizableSidebarWidth(collapsed ? DEFAULT_WIDTH : 0);

  return (
    <Resizable
      ref={groupRef}
      className="app-shell wiki-shell-resizable-layout"
      controller={controller}
      data-sidebar-layout
      data-sidebar-state={collapsed ? "collapsed" : "expanded"}
      onLayoutCommit={(_layout, details) => {
        if (details.reason === "imperative" || details.reason === "resize") return;
        const panel = groupRef.current?.querySelector<HTMLElement>("[data-sidebar-expanded-rail]");
        if (panel) setResizableSidebarWidth(Math.round(panel.getBoundingClientRect().width));
      }}
    >
      <div className="sidebar-collapsed-rail" data-sidebar-collapsed-rail>
        <button
          type="button"
          aria-label="Expand sidebar"
          className="sidebar-rail-button"
          onClick={toggle}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <line x1="3" y1="4.5" x2="15" y2="4.5" />
            <line x1="3" y1="9" x2="15" y2="9" />
            <line x1="3" y1="13.5" x2="15" y2="13.5" />
          </svg>
        </button>
      </div>
      <ResizablePanel
        id={SIDEBAR_PANEL_ID}
        className="sidebar-expanded-rail"
        data-sidebar-expanded-rail
        data-width-applied={widthApplied || undefined}
        defaultSize={`${DEFAULT_WIDTH}px`}
        minSize={`${MIN_WIDTH}px`}
        maxSize={`${MAX_WIDTH}px`}
      >
        <button
          type="button"
          aria-label="Collapse sidebar"
          className="sidebar-collapse-button"
          onClick={toggle}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <polyline points="11 4 7 8 11 12" />
          </svg>
        </button>
        {sidebar}
      </ResizablePanel>
      <ResizableHandle
        className="sidebar-resize-handle"
        data-sidebar-resize-handle
        aria-label="Resize sidebar"
      />
      <ResizablePanel id="wiki-content-panel" className="app-content">{children}</ResizablePanel>
    </Resizable>
  );
}
