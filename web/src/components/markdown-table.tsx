"use client";

import React, { useRef, useCallback, useState } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

/**
 * Wraps shadcn Table with draggable column-resize handles.
 * Designed to be used as react-markdown component overrides.
 */

function ResizableHead({
  children,
  style,
  ...props
}: React.ComponentProps<"th">) {
  const thRef = useRef<HTMLTableCellElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const th = thRef.current;
      if (!th) return;

      const startX = e.clientX;
      const startWidth = th.getBoundingClientRect().width;

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.max(60, startWidth + ev.clientX - startX);
        setWidth(newWidth);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    []
  );

  return (
    <TableHead
      ref={thRef}
      style={{ ...style, width: width ? `${width}px` : undefined }}
      className="relative group/resize"
      {...props}
    >
      {children}
      <div
        onMouseDown={onMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover/resize:opacity-100 hover:!opacity-100 bg-[var(--brand)] transition-opacity"
        role="separator"
        aria-orientation="vertical"
      />
    </TableHead>
  );
}

/* Component overrides for react-markdown */

export function MdTable(props: React.ComponentProps<"table">) {
  const [expanded, setExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [bleedStyle, setBleedStyle] = useState<React.CSSProperties>({});

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && wrapRef.current) {
        // Find the scrollable content ancestor to measure available width
        const scrollParent = wrapRef.current.closest("[class*='overflow-y-auto']") ||
          wrapRef.current.closest("[class*='overflow-hidden']")?.querySelector("[class*='overflow-y-auto']");
        const container = scrollParent || wrapRef.current.parentElement;
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const wrapRect = wrapRef.current.getBoundingClientRect();
          const availableWidth = containerRect.width - 40;
          const tableEl = wrapRef.current.querySelector("table");
          const tableWidth = tableEl?.scrollWidth ?? wrapRect.width;
          if (tableWidth < availableWidth) {
            const centerOffset = (availableWidth - tableWidth) / 2;
            setBleedStyle({
              marginLeft: -(wrapRect.left - containerRect.left) + 20 + centerOffset,
              marginRight: -(containerRect.right - wrapRect.right) + 20 + centerOffset,
            });
          } else {
            setBleedStyle({
              marginLeft: -(wrapRect.left - containerRect.left) + 20,
              marginRight: -(containerRect.right - wrapRect.right) + 20,
              overflow: "auto" as const,
            });
          }
        }
      } else {
        setBleedStyle({});
      }
      return next;
    });
  }, []);

  return (
    <div
      ref={wrapRef}
      className="not-prose my-4 relative group/table"
      style={expanded ? bleedStyle : undefined}
    >
      <button
        onClick={toggle}
        className="absolute top-1 right-1 z-10 opacity-0 group-hover/table:opacity-100 transition-opacity p-1 rounded bg-[var(--background)] border border-[var(--sidebar-border)] text-[var(--text-muted)] hover:text-[var(--brand)] hover:border-[var(--brand)]"
        aria-label={expanded ? "Collapse table" : "Expand table"}
        title={expanded ? "Collapse table" : "Expand table"}
      >
        {expanded ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2L4 2L4 4" />
            <path d="M14 2L12 2L12 4" />
            <path d="M2 14L4 14L4 12" />
            <path d="M14 14L12 14L12 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2L2 2L2 4" />
            <path d="M12 2L14 2L14 4" />
            <path d="M4 14L2 14L2 12" />
            <path d="M12 14L14 14L14 12" />
          </svg>
        )}
      </button>
      <Table {...props} className="w-full" />
    </div>
  );
}

export function MdThead(props: React.ComponentProps<"thead">) {
  return <TableHeader {...props} />;
}

export function MdTbody(props: React.ComponentProps<"tbody">) {
  return <TableBody {...props} />;
}

export function MdTr(props: React.ComponentProps<"tr">) {
  return <TableRow {...props} />;
}

export function MdTh(props: React.ComponentProps<"th">) {
  return <ResizableHead {...props} />;
}

export function MdTd(props: React.ComponentProps<"td">) {
  return <TableCell {...props} />;
}
