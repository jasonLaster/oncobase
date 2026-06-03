"use client";

import { useCallback, useRef } from "react";
import {
  setResizableSidebarWidth,
  useResizableSidebarWidth,
} from "@oncobase/wiki-shell";

// Drag-handle clamps. The sidebar-width STATE (localStorage `sidebar-width`,
// the cross-tab listeners, the `data-initial-sidebar-state` sync) lives in the
// shared `@oncobase/wiki-shell` ResizableLayout hooks so both readers share one
// source of truth. This reader keeps its own markup because its mobile layout
// has a fixed top header the content offsets for (`pt-12`), whereas the shared
// layout offsets a bottom nav instead.
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;

export function ResizableLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const width = useResizableSidebarWidth();
  const collapsed = width === 0;
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const toggle = useCallback(() => {
    if (collapsed) {
      setResizableSidebarWidth(DEFAULT_WIDTH);
    } else {
      setResizableSidebarWidth(0);
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
    setResizableSidebarWidth(next, { persist: false });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const delta = e.clientX - startX.current;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
    setResizableSidebarWidth(next);
  }, []);

  return (
    <div
      className="flex h-full min-h-0 overflow-hidden"
      data-sidebar-layout
      data-sidebar-state={collapsed ? "collapsed" : "expanded"}
    >
      <div
        data-sidebar-collapsed-rail
        className="hidden shrink-0 flex-col items-center border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] pt-2 md:flex md:w-12"
      >
        <button
          onClick={toggle}
          aria-label="Expand sidebar"
          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="4.5" x2="15" y2="4.5" />
            <line x1="3" y1="9" x2="15" y2="9" />
            <line x1="3" y1="13.5" x2="15" y2="13.5" />
          </svg>
        </button>
      </div>
      <div
        data-sidebar-expanded-rail
        className="group relative hidden min-h-0 shrink-0 overflow-hidden md:block"
        style={{ width }}
      >
        <button
          onClick={toggle}
          aria-label="Collapse sidebar"
          className="absolute right-2 top-2 z-10 rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-1 text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--foreground)] group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="11 4 7 8 11 12" />
          </svg>
        </button>
        {sidebar}
      </div>
      <div
        data-sidebar-expanded-rail
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="hidden w-[3px] shrink-0 cursor-col-resize bg-[var(--sidebar-border)] transition-colors hover:bg-[var(--brand)] active:bg-[var(--brand)] md:block"
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden pt-12 md:pt-0">
        {children}
      </div>
    </div>
  );
}
