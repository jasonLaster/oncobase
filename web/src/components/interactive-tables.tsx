"use client";

import { useEffect, useRef } from "react";

/**
 * Client island that progressively enhances server-rendered tables
 * with resize handles and expand/collapse controls.
 * Mounts once and attaches listeners to all <table> elements
 * inside the parent .prose container.
 */
export function InteractiveTables({
  disableAnchors,
}: {
  disableAnchors?: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prose = sentinelRef.current?.parentElement;
    if (!prose) return;

    // --- Heading anchors (desktop only — touch devices can't hover) ---
    if (!disableAnchors && window.matchMedia("(hover: hover)").matches) {
      attachHeadingAnchors(prose);
    }

    // --- Table enhancements ---
    const tables = prose.querySelectorAll<HTMLTableElement>("table");
    const cleanups: (() => void)[] = [];

    tables.forEach((table) => {
      // If the table has a colgroup with explicit widths, use fixed layout
      // so col widths are respected and the table can exceed the container
      const colgroup = table.querySelector("colgroup");
      if (colgroup) {
        const cols = colgroup.querySelectorAll<HTMLElement>("col");
        let totalWidth = 0;
        cols.forEach((col) => {
          const w = parseInt(col.style.width, 10);
          if (w) totalWidth += w;
        });
        if (totalWidth > 0) {
          table.style.tableLayout = "fixed";
          table.style.width = `${totalWidth}px`;
        }
      }

      cleanups.push(wrapWithExpandCollapse(table));
      table.querySelectorAll<HTMLTableCellElement>("thead th").forEach((th) => {
        cleanups.push(attachResizeHandle(th));
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, [disableAnchors]);

  // Hidden sentinel so we can find the parent .prose div
  return <div ref={sentinelRef} style={{ display: "none" }} />;
}

// ─── Heading anchors ──────────────────────────────────────────

function attachHeadingAnchors(container: HTMLElement) {
  const headings = container.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6"
  );
  headings.forEach((heading) => {
    const id = heading.id;
    if (!id) return;
    // Guard against duplicate anchors (e.g. React strict mode double-mount)
    if (heading.querySelector(".heading-anchor")) return;

    heading.classList.add("group", "relative");

    const anchor = document.createElement("a");
    anchor.href = `#${id}`;
    anchor.className =
      "heading-anchor opacity-0 group-hover:opacity-100 text-[var(--text-muted)] no-underline hover:no-underline hover:text-[var(--brand)] transition-opacity cursor-pointer";
    anchor.setAttribute("aria-label", `Link to "${heading.textContent}"`);
    anchor.textContent = "#";

    heading.appendChild(anchor);
  });
}

// ─── Table expand / collapse ──────────────────────────────────

function wrapWithExpandCollapse(table: HTMLTableElement): () => void {
  // Reuse the SSR-rendered scroll wrapper if present, otherwise create one.
  const existingWrapper = table.parentElement?.classList.contains("table-scroll-wrapper")
    ? (table.parentElement as HTMLDivElement)
    : null;

  const wrapper = existingWrapper ?? document.createElement("div");
  if (!existingWrapper) {
    wrapper.className = "not-prose my-4 relative group/table table-scroll-wrapper";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  } else {
    wrapper.classList.add("not-prose", "my-4", "relative", "group/table");
  }

  // Detect horizontal overflow for scroll indicator
  const updateScrollable = () => {
    if (wrapper.scrollWidth > wrapper.clientWidth + 2) {
      wrapper.setAttribute("data-scrollable", "");
    } else {
      wrapper.removeAttribute("data-scrollable");
    }
  };
  const onScroll = () => {
    if (wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 2) {
      wrapper.setAttribute("data-scrolled-end", "");
    } else {
      wrapper.removeAttribute("data-scrolled-end");
    }
  };
  updateScrollable();
  wrapper.addEventListener("scroll", onScroll);
  const resizeObserver = new ResizeObserver(updateScrollable);
  resizeObserver.observe(wrapper);

  // Expand/collapse button
  const btn = document.createElement("button");
  btn.className =
    "absolute top-1 right-1 z-10 opacity-0 group-hover/table:opacity-100 transition-opacity p-1 rounded bg-[var(--background)] border border-[var(--sidebar-border)] text-[var(--text-muted)] hover:text-[var(--brand)] hover:border-[var(--brand)]";
  btn.setAttribute("aria-label", "Expand table");
  btn.title = "Expand table";
  btn.innerHTML = expandIcon;

  let expanded = false;

  const toggle = () => {
    expanded = !expanded;
    btn.innerHTML = expanded ? collapseIcon : expandIcon;
    btn.setAttribute("aria-label", expanded ? "Collapse table" : "Expand table");
    btn.title = expanded ? "Collapse table" : "Expand table";

    if (expanded) {
      // Expand to full available width, left-aligned
      const scrollParent =
        wrapper.closest("[class*='overflow-y-auto']") ||
        wrapper
          .closest("[class*='overflow-hidden']")
          ?.querySelector("[class*='overflow-y-auto']");
      const container = scrollParent || wrapper.parentElement;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const wrapRect = wrapper.getBoundingClientRect();
        wrapper.style.marginLeft = `${-(wrapRect.left - containerRect.left) + 20}px`;
        wrapper.style.marginRight = `${-(containerRect.right - wrapRect.right) + 20}px`;
      }
    } else {
      wrapper.style.marginLeft = "";
      wrapper.style.marginRight = "";
    }
  };

  btn.addEventListener("click", toggle);
  wrapper.appendChild(btn);

  // Auto-expand tables with 5+ columns
  const colCount = table.querySelectorAll("thead th").length;
  if (colCount >= 5) {
    toggle();
  }

  return () => {
    btn.removeEventListener("click", toggle);
    wrapper.removeEventListener("scroll", onScroll);
    resizeObserver.disconnect();
    // Only unwrap if we created the wrapper (not the SSR one)
    if (!existingWrapper && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(table, wrapper);
      wrapper.remove();
    }
  };
}

// ─── Column resize handle ─────────────────────────────────────

function attachResizeHandle(th: HTMLTableCellElement): () => void {
  th.classList.add("relative", "group/resize");

  const handle = document.createElement("div");
  handle.className =
    "absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover/resize:opacity-100 hover:!opacity-100 bg-[var(--brand)] transition-opacity";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  th.appendChild(handle);

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const table = th.closest("table") as HTMLTableElement | null;
    const startTableWidth = table?.getBoundingClientRect().width ?? 0;

    // Find the matching <col> element for fixed-layout tables
    const thIndex = Array.from(th.parentElement?.children ?? []).indexOf(th);
    const col = table?.querySelector(`colgroup col:nth-child(${thIndex + 1})`) as HTMLElement | null;

    const onMouseMove = (ev: MouseEvent) => {
      const newColWidth = Math.max(20, startWidth + ev.clientX - startX);
      const actualDelta = newColWidth - startWidth;
      th.style.width = `${newColWidth}px`;
      if (col) col.style.width = `${newColWidth}px`;
      if (table) {
        table.style.width = `${startTableWidth + actualDelta}px`;
      }
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
  };

  handle.addEventListener("mousedown", onMouseDown);

  return () => {
    handle.removeEventListener("mousedown", onMouseDown);
    handle.remove();
  };
}

// ─── SVG icons ────────────────────────────────────────────────

const expandIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2L2 2L2 4"/><path d="M12 2L14 2L14 4"/><path d="M4 14L2 14L2 12"/><path d="M12 14L14 14L14 12"/></svg>`;
const collapseIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2L4 2L4 4"/><path d="M14 2L12 2L12 4"/><path d="M2 14L4 14L4 12"/><path d="M14 14L12 14L12 12"/></svg>`;
