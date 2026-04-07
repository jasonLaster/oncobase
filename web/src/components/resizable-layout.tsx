"use client";

import { useCallback, useRef, useState } from "react";

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;
const STORAGE_KEY = "sidebar-width";

function getInitialWidth() {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  }
  return DEFAULT_WIDTH;
}

export function ResizableLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [width, setWidth] = useState(getInitialWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

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
    localStorage.setItem(STORAGE_KEY, String(next));
  }, []);

  return (
    <>
      {/* Desktop: resizable sidebar */}
      <div className="hidden md:flex min-h-0 overflow-hidden">
        <div
          className="shrink-0 min-h-0 overflow-hidden"
          style={{ width }}
        >
          {sidebar}
        </div>
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="w-[3px] shrink-0 bg-[var(--sidebar-border)] hover:bg-[var(--brand)] active:bg-[var(--brand)] transition-colors cursor-col-resize"
        />
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {children}
        </div>
      </div>

      {/* Mobile: stacked (sidebar is a drawer) */}
      <div className="md:hidden min-h-0 overflow-hidden">
        {sidebar}
        <div className="min-w-0 min-h-0 overflow-hidden">{children}</div>
      </div>
    </>
  );
}
