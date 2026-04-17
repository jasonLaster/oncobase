"use client";

import * as React from "react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  getExpandedTableBleed,
  observeExpandedTableBleed,
} from "@/lib/table-expansion";
import {
  attachSmartResizeHandles,
  installSmartTableLayout,
} from "@/lib/smart-table-layout";

function assignRef<T>(
  ref: React.ForwardedRef<T>,
  value: T | null
) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

const expandIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 2L2 2L2 4" />
    <path d="M12 2L14 2L14 4" />
    <path d="M4 14L2 14L2 12" />
    <path d="M12 14L14 14L14 12" />
  </svg>
);

const collapseIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 2L4 2L4 4" />
    <path d="M14 2L12 2L12 4" />
    <path d="M2 14L4 14L4 12" />
    <path d="M14 14L12 14L12 12" />
  </svg>
);

export const SmartTable = React.forwardRef<
  HTMLTableElement,
  React.ComponentPropsWithoutRef<"table">
>(({ className, ...props }, forwardedRef) => {
  const tableRef = React.useRef<HTMLTableElement>(null);
  const shellRef = React.useRef<HTMLDivElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const expandedCleanupRef = React.useRef<(() => void) | null>(null);
  const expandedRef = React.useRef(false);
  const bleedFrameRef = React.useRef(0);
  const [expanded, setExpanded] = React.useState(false);

  const setTableRef = React.useCallback(
    (node: HTMLTableElement | null) => {
      tableRef.current = node;
      assignRef(forwardedRef, node);
    },
    [forwardedRef]
  );

  React.useEffect(() => {
    const table = tableRef.current;
    const wrapper = wrapperRef.current;
    if (!table || !wrapper) {
      return;
    }

    return installSmartTableLayout(table, wrapper);
  }, []);

  React.useEffect(() => {
    const table = tableRef.current;
    if (!table) {
      return;
    }

    return attachSmartResizeHandles(table);
  }, []);

  React.useEffect(() => {
    const table = tableRef.current;
    const wrapper = wrapperRef.current;
    if (!table || !wrapper) {
      return;
    }

    const updateScrollable = () => {
      if (wrapper.scrollWidth > wrapper.clientWidth + 2) {
        wrapper.setAttribute("data-scrollable", "");
      } else {
        wrapper.removeAttribute("data-scrollable");
      }

      if (wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 2) {
        wrapper.setAttribute("data-scrolled-end", "");
      } else {
        wrapper.removeAttribute("data-scrolled-end");
      }
    };

    const onScroll = () => {
      updateScrollable();
    };

    const resizeObserver = new ResizeObserver(updateScrollable);
    resizeObserver.observe(wrapper);
    resizeObserver.observe(table);

    wrapper.addEventListener("scroll", onScroll);
    requestAnimationFrame(updateScrollable);

    return () => {
      wrapper.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, []);

  React.useEffect(() => {
    const wrapper = wrapperRef.current;

    return () => {
      if (bleedFrameRef.current !== 0) {
        window.cancelAnimationFrame(bleedFrameRef.current);
        bleedFrameRef.current = 0;
      }
      expandedCleanupRef.current?.();
      expandedCleanupRef.current = null;
      wrapper?.style.removeProperty("margin-left");
      wrapper?.style.removeProperty("margin-right");
    };
  }, []);

  const toggleExpanded = React.useCallback(() => {
    const shell = shellRef.current;
    const wrapper = wrapperRef.current;
    const next = !expandedRef.current;
    expandedRef.current = next;

    expandedCleanupRef.current?.();
    expandedCleanupRef.current = null;

    if (next && shell && wrapper) {
      if (bleedFrameRef.current !== 0) {
        window.cancelAnimationFrame(bleedFrameRef.current);
      }
      bleedFrameRef.current = window.requestAnimationFrame(() => {
        bleedFrameRef.current = 0;
        const bleed = getExpandedTableBleed(wrapper, shell);
        if (bleed) {
          wrapper.style.marginLeft = `${bleed.marginLeft}px`;
          wrapper.style.marginRight = `${bleed.marginRight}px`;
        }
      });

      expandedCleanupRef.current = observeExpandedTableBleed(
        wrapper,
        shell,
        (nextBleed) => {
          if (nextBleed) {
            wrapper.style.marginLeft = `${nextBleed.marginLeft}px`;
            wrapper.style.marginRight = `${nextBleed.marginRight}px`;
            return;
          }

          wrapper.style.removeProperty("margin-left");
          wrapper.style.removeProperty("margin-right");
        }
      );
    } else if (wrapper) {
      if (bleedFrameRef.current !== 0) {
        window.cancelAnimationFrame(bleedFrameRef.current);
        bleedFrameRef.current = 0;
      }
      wrapper.style.removeProperty("margin-left");
      wrapper.style.removeProperty("margin-right");
    }

    setExpanded(next);
  }, []);

  return (
    <div
      ref={shellRef}
      data-smart-table-shell
      className="not-prose my-4 relative pt-3 group/table"
    >
      <button
        type="button"
        onClick={toggleExpanded}
        className="absolute top-0 right-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/96 text-[var(--text-muted)] opacity-100 shadow-sm transition-all md:opacity-0 md:group-hover/table:opacity-100 hover:border-[var(--brand)] hover:text-[var(--brand)]"
        aria-label={expanded ? "Collapse table" : "Expand table"}
        title={expanded ? "Collapse table" : "Expand table"}
      >
        {expanded ? collapseIcon : expandIcon}
      </button>

      <div
        ref={wrapperRef}
        data-smart-table-wrapper
        className="table-scroll-wrapper"
      >
        <table
          ref={setTableRef}
          data-smart-table
          className={cn("caption-bottom text-sm", className)}
          {...props}
        />
      </div>
    </div>
  );
});
SmartTable.displayName = "SmartTable";

export const SmartTableHeader = TableHeader;
export const SmartTableBody = TableBody;
export const SmartTableRow = TableRow;
export const SmartTableHead = TableHead;
export const SmartTableCell = TableCell;
