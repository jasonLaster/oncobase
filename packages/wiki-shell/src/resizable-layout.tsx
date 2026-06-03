"use client";

import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;
const STORAGE_KEY = "sidebar-width";

let listeners: Array<() => void> = [];
let widthCache: number | null = null;

function readStoredWidth() {
  if (typeof window === "undefined") return DEFAULT_WIDTH;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_WIDTH;

  const width = Number.parseInt(stored, 10);
  if (!Number.isFinite(width) || width < 0 || width > MAX_WIDTH) {
    return DEFAULT_WIDTH;
  }
  return width;
}

function syncSidebarState(width: number) {
  if (typeof window === "undefined") return;
  window.document.documentElement.dataset.initialSidebarState =
    width === 0 ? "collapsed" : "expanded";
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
    window.localStorage.setItem(STORAGE_KEY, String(nextWidth));
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
  const dragging = useRef(false);
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
    setResizableSidebarWidth(nextWidth, { persist: false });
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
        style={{ width }}
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
      />
      <div className="app-content">{children}</div>
    </div>
  );
}