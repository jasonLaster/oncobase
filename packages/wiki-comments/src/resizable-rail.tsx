"use client";

import {
  createResizableController,
  Resizable,
  ResizableHandle,
  ResizablePanel,
} from "@oncobase/ui/resizable";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "./utils.ts";

const USER_REASONS = new Set(["drag", "step-key", "collapse"]);

type ResizableRailProps = {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number, options?: { persist?: boolean }) => void;
  handleLabel: string;
  className?: string;
  railClassName?: string;
  railProps?: Record<`data-${string}`, string | boolean | undefined>;
  children: ReactNode;
};

// The group covers the page beside the rail; its spacer panel lets presses through.
export function ResizableRail({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  handleLabel,
  className,
  railClassName,
  railProps,
  children,
}: ResizableRailProps) {
  const [controller] = useState(createResizableController);
  const groupRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const railId = useId();

  const toPixels = (layout: number[]) => {
    const shared = (spacerRef.current?.offsetWidth ?? 0) + (railRef.current?.offsetWidth ?? 0);
    return Math.round(((layout[1] ?? 0) / 100) * shared);
  };

  // Panel sizes are shares of the group, so hold the rail's pixel width when
  // the group resizes, after the group has measured its new size.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = railRef.current?.offsetWidth ?? width;
        if (Math.abs(current - width) >= 1) controller.resize(railId, `${width}px`);
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(group);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [controller, railId, width]);

  return (
    <Resizable
      ref={groupRef}
      controller={controller}
      className={cn("pointer-events-none fixed z-30", className)}
      onLayoutChange={(layout, details) => {
        if (USER_REASONS.has(details.reason)) onWidthChange(toPixels(layout));
      }}
      onLayoutCommit={(layout, details) => {
        if (USER_REASONS.has(details.reason)) onWidthChange(toPixels(layout), { persist: true });
      }}
    >
      <ResizablePanel ref={spacerRef} className="pointer-events-none" />
      <ResizableHandle
        aria-label={handleLabel}
        className="pointer-events-auto relative z-40 -mr-[3px] w-[3px] shrink-0 cursor-col-resize bg-[var(--sidebar-border)] outline-none transition-colors hover:bg-[var(--brand)] focus-visible:bg-[var(--brand)] data-[dragging]:bg-[var(--brand)] data-[hovering]:bg-[var(--brand)]"
      />
      <ResizablePanel
        {...railProps}
        ref={railRef}
        id={railId}
        defaultSize={`${width}px`}
        minSize={`${minWidth}px`}
        maxSize={`${maxWidth}px`}
        render={<aside />}
        className={cn("pointer-events-auto flex flex-col", railClassName)}
      >
        {children}
      </ResizablePanel>
    </Resizable>
  );
}
