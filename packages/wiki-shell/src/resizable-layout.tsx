import { safeLocalStorage } from "@oncobase/safe-storage";
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  SIDEBAR_DEFAULT_WIDTH as DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH as MAX_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY as STORAGE_KEY,
  SIDEBAR_WIDTH_VARIABLE,
} from "./sidebar-startup.ts";

const MIN_WIDTH = 160;
// The rail's width comes from a custom property on <html> (set before the
// first paint by installSidebarStartupState, then kept in sync below), never
// from a per-user inline width, so server and client markup are the same.
const RAIL_WIDTH = `var(${SIDEBAR_WIDTH_VARIABLE}, ${DEFAULT_WIDTH}px)`;

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

export type ResizableLayoutProps = {
  children: ReactNode;
  sidebar: ReactNode;
};

export function ResizableLayout({ children, sidebar }: ResizableLayoutProps) {
  const width = useResizableSidebarWidth();
  const collapsed = width === 0;
  // A document without the startup script still gets the saved width before paint.
  useLayoutEffect(() => { syncSidebarState(getWidthSnapshot()); }, []);
  const dragging = useRef(false);
  const lastWidth = useRef(0);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const toggle = useCallback(() => {
    setResizableSidebarWidth(collapsed ? DEFAULT_WIDTH : 0);
  }, [collapsed]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragging.current = true;
      startX.current = event.clientX;
      startWidth.current = width || DEFAULT_WIDTH;
      lastWidth.current = startWidth.current;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = event.clientX - startX.current;
    const nextWidth = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, startWidth.current + delta),
    );
    lastWidth.current = nextWidth;
    setResizableSidebarWidth(nextWidth, { persist: false });
  }, []);

  // A touch scroll, alt-tab or OS gesture can cancel the drag without a
  // pointer-up. Keep the width reached so far and stop tracking, or hovering
  // the handle later would keep resizing.
  const onPointerCancel = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setResizableSidebarWidth(lastWidth.current);
  }, []);

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const delta = event.clientX - startX.current;
    const nextWidth = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, startWidth.current + delta),
    );
    setResizableSidebarWidth(nextWidth);
  }, []);

  return (
    <div
      className="app-shell wiki-shell-resizable-layout"
      data-sidebar-layout
      data-sidebar-state={collapsed ? "collapsed" : "expanded"}
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
      <div
        className="sidebar-expanded-rail"
        data-sidebar-expanded-rail
        style={{ width: RAIL_WIDTH }}
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
      </div>
      <div
        className="sidebar-resize-handle"
        data-sidebar-resize-handle
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
      />
      <div className="app-content">{children}</div>
    </div>
  );
}
