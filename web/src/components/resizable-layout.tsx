"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;
const STORAGE_KEY = "sidebar-width";

export function ResizableLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= 0 && n <= MAX_WIDTH) setWidth(n);
    }
  }, []);
  const collapsed = width === 0;
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const toggle = useCallback(() => {
    if (collapsed) {
      const restored = DEFAULT_WIDTH;
      setWidth(restored);
      localStorage.setItem(STORAGE_KEY, String(restored));
    } else {
      setWidth(0);
      localStorage.setItem(STORAGE_KEY, "0");
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
    setWidth(next);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const delta = e.clientX - startX.current;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
    setWidth(next);
    localStorage.setItem(STORAGE_KEY, String(next));
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
                className="absolute top-2 right-2 z-10 p-1 rounded-md bg-[var(--sidebar-bg)] border border-[var(--sidebar-border)] shadow-sm text-[var(--text-muted)] hover:text-[var(--foreground)] opacity-0 group-hover:opacity-100 transition-opacity"
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

      {/* Mobile: stacked (sidebar is a drawer) */}
      <div className="md:hidden h-full min-h-0 overflow-hidden">
        {sidebar}
        <div className="min-w-0 h-full min-h-0 overflow-hidden">{children}</div>
      </div>
    </>
  );
}
