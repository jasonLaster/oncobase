"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;
const STORAGE_KEY = "sidebar-width";
let listeners: Array<() => void> = [];
let widthCache: number | null = null;

function readStoredWidth() {
  if (typeof window === "undefined") return DEFAULT_WIDTH;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const nextWidth = parseInt(stored, 10);
    if (nextWidth >= 0 && nextWidth <= MAX_WIDTH) {
      return nextWidth;
    }
  }

  return DEFAULT_WIDTH;
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  listeners.push(onStoreChange);

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;

    widthCache = null;
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

  if (widthCache !== null) {
    return widthCache;
  }

  widthCache = readStoredWidth();
  return widthCache;
}

function getServerWidthSnapshot() {
  return DEFAULT_WIDTH;
}

function updateWidth(
  nextWidth: number,
  options?: {
    persist?: boolean;
  }
) {
  if (typeof window === "undefined") return;

  widthCache = nextWidth;

  if (options?.persist ?? true) {
    window.localStorage.setItem(STORAGE_KEY, String(nextWidth));
  }

  listeners.forEach((listener) => listener());
}

export function ResizableLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const width = useSyncExternalStore(
    subscribe,
    getWidthSnapshot,
    getServerWidthSnapshot
  );
  const collapsed = width === 0;
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const toggle = useCallback(() => {
    if (collapsed) {
      updateWidth(DEFAULT_WIDTH);
    } else {
      updateWidth(0);
    }
  }, [collapsed]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
    updateWidth(next, { persist: false });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const delta = e.clientX - startX.current;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
    updateWidth(next);
  }, []);

  return (
    <>
      {/* Desktop: resizable sidebar */}
      <div className="hidden md:flex min-h-0 overflow-hidden">
        {collapsed ? (
          <div className="shrink-0 flex flex-col items-center pt-2 w-12 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)]">
            <button
              onClick={toggle}
              aria-label="Expand sidebar"
              className="p-1.5 rounded-md hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="4.5" x2="15" y2="4.5" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="13.5" x2="15" y2="13.5" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div
              className="shrink-0 min-h-0 overflow-hidden relative group"
              style={{ width }}
            >
              <button
                onClick={toggle}
                aria-label="Collapse sidebar"
                className="absolute top-2 right-2 z-10 p-1 rounded-md bg-[var(--sidebar-bg)] border border-[var(--sidebar-border)] shadow-sm text-[var(--text-muted)] hover:text-[var(--foreground)] opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="11 4 7 8 11 12" />
                </svg>
              </button>
              {sidebar}
            </div>
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="w-[3px] shrink-0 bg-[var(--sidebar-border)] hover:bg-[var(--brand)] active:bg-[var(--brand)] transition-colors cursor-col-resize"
            />
          </>
        )}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {children}
        </div>
      </div>

      {/* Mobile: content only (navigation via BottomNav) */}
      <div className="md:hidden h-full min-h-0 overflow-hidden pb-12">
        <div className="min-w-0 h-full min-h-0 overflow-hidden">{children}</div>
      </div>
    </>
  );
}
