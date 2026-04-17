"use client";

import { useEffect, useRef } from "react";
import {
  attachSmartResizeHandles,
  installSmartTableLayout,
} from "@/lib/smart-table-layout";

const COMMENTS_PANE_EVENT = "comments-pane-state-change";
const expandedTableMemory = new Map<string, boolean>();

/**
 * Client island that progressively enhances server-rendered prose content
 * with heading anchors and smarter markdown tables.
 */
export function InteractiveTables({
  disableAnchors,
}: {
  disableAnchors?: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prose = sentinelRef.current?.parentElement;
    if (!prose) {
      return;
    }

    if (!disableAnchors && window.matchMedia("(hover: hover)").matches) {
      attachHeadingAnchors(prose);
    }

    const cleanups: Array<() => void> = [];
    const tables = prose.querySelectorAll<HTMLTableElement>("table");

    tables.forEach((table, index) => {
      const persistenceKey = `${window.location.pathname}::prose-table-${index}`;
      const { wrapper, cleanup } = wrapWithExpandCollapse(table, {
        persistenceKey,
      });
      cleanups.push(cleanup);
      cleanups.push(
        installSmartTableLayout(table, wrapper, { persistenceKey })
      );
      cleanups.push(attachSmartResizeHandles(table, { persistenceKey }));
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [disableAnchors]);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}

function attachHeadingAnchors(container: HTMLElement) {
  const headings = container.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6"
  );

  headings.forEach((heading) => {
    const id = heading.id;
    if (!id || heading.querySelector(".heading-anchor")) {
      return;
    }

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

function wrapWithExpandCollapse(
  table: HTMLTableElement,
  options: { persistenceKey?: string } = {}
) {
  const existingWrapper = table.parentElement?.classList.contains("table-scroll-wrapper")
    ? (table.parentElement as HTMLDivElement)
    : null;
  const existingShell = existingWrapper?.parentElement?.hasAttribute("data-smart-table-shell")
    ? (existingWrapper.parentElement as HTMLDivElement)
    : null;

  const wrapper = existingWrapper ?? document.createElement("div");
  const shell = existingShell ?? document.createElement("div");

  if (!existingShell) {
    shell.setAttribute("data-smart-table-shell", "");
    shell.className = "not-prose my-4 relative pt-3 group/table";
  } else {
    shell.classList.add("not-prose", "my-4", "relative", "pt-3", "group/table");
  }

  shell
    .querySelectorAll<HTMLElement>(':scope > [data-smart-table-toggle="true"]')
    .forEach((toggle) => toggle.remove());

  if (options.persistenceKey) {
    document
      .querySelectorAll<HTMLElement>(
        `.table-expansion-layer[data-smart-table-layer="${CSS.escape(
          options.persistenceKey
        )}"]`
      )
      .forEach((layer) => layer.remove());
  }

  if (!existingWrapper) {
    wrapper.className = "table-scroll-wrapper";
    if (!existingShell) {
      table.parentNode?.insertBefore(shell, table);
    }
    shell.appendChild(wrapper);
    wrapper.appendChild(table);
  } else {
    wrapper.classList.add("table-scroll-wrapper");
    if (!existingShell) {
      wrapper.parentNode?.insertBefore(shell, wrapper);
      shell.appendChild(wrapper);
    }
  }

  wrapper.setAttribute("data-smart-table-wrapper", "");

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

  const updateReservedHeight = () => {
    if (!expanded) {
      return;
    }

    shell.style.minHeight = `${Math.ceil(
      shellOffsetTop + wrapper.getBoundingClientRect().height
    )}px`;
  };

  const syncExpandedLayout = () => {
    syncCollapsedStateForNarrowViewport();
    updateButtonVisibility();
    updateScrollable();
    if (!expanded) {
      return;
    }

    applyExpansionLayout();
  };

  const onWheel = (event: WheelEvent) => {
    if (!expanded) {
      return;
    }

    const scrollOwner = getVerticalScrollContainer(shell);
    if (!scrollOwner) {
      return;
    }

    let handled = false;

    if (Math.abs(event.deltaX) > 0.01) {
      wrapper.scrollLeft += event.deltaX;
      handled = true;
    }

    if (Math.abs(event.deltaY) > 0.01) {
      if (
        scrollOwner === document.documentElement ||
        scrollOwner === document.body ||
        scrollOwner === document.scrollingElement
      ) {
        window.scrollBy({ top: event.deltaY, left: 0, behavior: "auto" });
      } else {
        scrollOwner.scrollTop += event.deltaY;
      }
      handled = true;
    }

    if (handled) {
      event.preventDefault();
    }
  };

  wrapper.addEventListener("scroll", onScroll);
  wrapper.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(() => {
    syncExpandedLayout();
  });
  resizeObserver.observe(wrapper);
  resizeObserver.observe(table);

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Expand table");
  button.title = "Expand table";
  button.dataset.smartTableToggle = "true";
  button.innerHTML = expandIcon;

  let expanded = false;
  let expandedCleanup: (() => void) | null = null;
  let expansionLayer: HTMLDivElement | null = null;
  let shellOffsetTop = 0;
  let restoreFrame = 0;
  let destroyed = false;

  const shouldUseExpansionOverlay = () =>
    window.matchMedia("(min-width: 1024px)").matches;

  const updateButtonVisibility = () => {
    button.style.display = shouldUseExpansionOverlay() ? "" : "none";
  };

  const syncCollapsedStateForNarrowViewport = () => {
    if (shouldUseExpansionOverlay() || !expanded) {
      return;
    }

    expanded = false;
    persistExpandedPreference(false);
    button.innerHTML = expandIcon;
    button.setAttribute("aria-label", "Expand table");
    button.title = "Expand table";
  };

  const updateButtonPlacement = () => {
    button.className = expanded
      ? "absolute -top-3 right-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/96 text-[var(--text-muted)] opacity-100 shadow-sm transition-all hover:border-[var(--brand)] hover:text-[var(--brand)]"
      : "absolute top-0 right-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/96 text-[var(--text-muted)] opacity-100 shadow-sm transition-all md:opacity-0 md:group-hover/table:opacity-100 hover:border-[var(--brand)] hover:text-[var(--brand)]";

    if (expanded && expansionLayer) {
      if (button.parentElement !== expansionLayer) {
        expansionLayer.appendChild(button);
      }
      return;
    }

    if (button.parentElement !== shell) {
      shell.appendChild(button);
    }
  };

  const releaseExpansionLayer = () => {
    expandedCleanup?.();
    expandedCleanup = null;
    shell.style.minHeight = "";
    wrapper.style.removeProperty("width");
    wrapper.style.removeProperty("margin");

    if (wrapper.parentElement !== shell) {
      shell.appendChild(wrapper);
    }

    expansionLayer?.remove();
    expansionLayer = null;
  };

  const readExpandedPreference = () => {
    return options.persistenceKey
      ? expandedTableMemory.get(options.persistenceKey) === true
      : false;
  };

  const persistExpandedPreference = (nextExpanded: boolean) => {
    if (!options.persistenceKey) {
      return;
    }

    if (nextExpanded) {
      expandedTableMemory.set(options.persistenceKey, true);
    } else {
      expandedTableMemory.delete(options.persistenceKey);
    }
  };

  const applyExpansionLayout = () => {
    if (destroyed) {
      return;
    }

    if (!shouldUseExpansionOverlay()) {
      syncCollapsedStateForNarrowViewport();
      releaseExpansionLayer();
      updateButtonPlacement();
      updateButtonVisibility();
      updateScrollable();
      return;
    }

    if (wrapper.parentElement === shell) {
      const shellRect = shell.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      shellOffsetTop = wrapperRect.top - shellRect.top;
    }

    const layout = getExpansionLayerLayout(
      wrapper,
      shell,
      shellOffsetTop
    );
    if (!layout) {
      return;
    }

    if (!expansionLayer) {
      expansionLayer = document.createElement("div");
      expansionLayer.className = "table-expansion-layer";
      expansionLayer.style.position = "fixed";
      expansionLayer.style.zIndex = "20";
      expansionLayer.style.boxSizing = "border-box";
      if (options.persistenceKey) {
        expansionLayer.dataset.smartTableLayer = options.persistenceKey;
      }
    }

    expansionLayer.style.left = `${layout.left}px`;
    expansionLayer.style.top = `${layout.top}px`;
    expansionLayer.style.width = `${layout.width}px`;
    if (!expansionLayer.isConnected || expansionLayer.parentElement !== layout.parent) {
      layout.parent.appendChild(expansionLayer);
    }

    wrapper.style.width = "100%";
    wrapper.style.margin = "0";
    if (wrapper.parentElement !== expansionLayer) {
      expansionLayer.appendChild(wrapper);
    }

    updateButtonPlacement();
    updateReservedHeight();
  };

  const collapseExpansion = () => {
    if (destroyed) {
      return;
    }

    releaseExpansionLayer();
    updateButtonPlacement();
  };

  const toggle = () => {
    if (destroyed) {
      return;
    }

    expanded = !expanded;
    button.innerHTML = expanded ? collapseIcon : expandIcon;
    button.setAttribute("aria-label", expanded ? "Collapse table" : "Expand table");
    button.title = expanded ? "Collapse table" : "Expand table";

    if (expanded) {
      persistExpandedPreference(true);
      applyExpansionLayout();
      expandedCleanup = observeExpansionLayerLayout(wrapper, shell, () => {
        applyExpansionLayout();
      });
    } else {
      persistExpandedPreference(false);
      collapseExpansion();
    }
  };

  button.addEventListener("click", toggle);
  updateButtonPlacement();
  updateButtonVisibility();

  restoreFrame = window.requestAnimationFrame(() => {
    restoreFrame = 0;
    if (destroyed) {
      return;
    }

    syncCollapsedStateForNarrowViewport();
    updateButtonVisibility();
    updateScrollable();
    if (readExpandedPreference() && shouldUseExpansionOverlay()) {
      toggle();
    }
  });

  return {
    wrapper,
    cleanup: () => {
      if (restoreFrame !== 0) {
        window.cancelAnimationFrame(restoreFrame);
        restoreFrame = 0;
      }
      collapseExpansion();
      destroyed = true;
      button.removeEventListener("click", toggle);
      button.remove();
      wrapper.removeEventListener("scroll", onScroll);
      wrapper.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();

      if (!existingShell && shell.parentNode) {
        if (existingWrapper) {
          shell.parentNode.insertBefore(wrapper, shell);
        } else {
          shell.parentNode.insertBefore(table, shell);
          wrapper.remove();
        }
        shell.remove();
      }
    },
  };
}

function getExpansionLayerLayout(
  wrapper: HTMLElement,
  shell: HTMLElement,
  shellOffsetTop: number
) {
  const shellRect = shell.getBoundingClientRect();
  const contentWrapper = shell.closest(".comments-content-wrapper");
  const contentRect = contentWrapper instanceof HTMLElement
    ? contentWrapper.getBoundingClientRect()
    : null;
  const contentStyle = contentWrapper instanceof HTMLElement
    ? window.getComputedStyle(contentWrapper)
    : null;
  const contentLeft =
    contentRect && contentStyle
      ? contentRect.left + (Number.parseFloat(contentStyle.paddingLeft) || 0)
      : shellRect.left;
  const contentRight =
    contentRect && contentStyle
      ? contentRect.right - (Number.parseFloat(contentStyle.paddingRight) || 0)
      : shellRect.right;

  const leftRect = getLeftRailRect();
  const rightRect = getRightRailRect();
  const gutter = 20;
  const left = leftRect ? leftRect.right + gutter : contentLeft;
  const right = rightRect ? rightRect.left - gutter : contentRight;
  const width = right - left;

  if (width <= 0) {
    return null;
  }

  return {
    parent: document.body,
    left,
    top: shellRect.top + shellOffsetTop,
    width,
  };
}

function observeExpansionLayerLayout(
  wrapper: HTMLElement,
  shell: HTMLElement,
  onLayout: () => void
) {
  const contentWrapper = shell.closest(".comments-content-wrapper");
  const scrollContainer = getVerticalScrollContainer(shell);

  let frame = 0;
  let observedTargets = new Set<HTMLElement>();

  const scheduleUpdate = () => {
    if (frame !== 0) {
      return;
    }

    frame = window.requestAnimationFrame(() => {
      frame = 0;
      syncResizeTargets();
      onLayout();
    });
  };

  const resizeObserver = new ResizeObserver(scheduleUpdate);
  const syncResizeTargets = () => {
    const nextTargets = new Set<HTMLElement>([shell]);

    if (contentWrapper instanceof HTMLElement) {
      nextTargets.add(contentWrapper);
    }

    const leftRail = getLeftRailElement();
    const rightRail = getRightRailElement();
    if (leftRail) {
      nextTargets.add(leftRail);
    }
    if (rightRail) {
      nextTargets.add(rightRail);
    }

    observedTargets.forEach((target) => {
      if (!nextTargets.has(target)) {
        resizeObserver.unobserve(target);
      }
    });

    nextTargets.forEach((target) => {
      if (!observedTargets.has(target)) {
        resizeObserver.observe(target);
      }
    });

    observedTargets = nextTargets;
  };

  syncResizeTargets();

  const mutationObserver = new MutationObserver(scheduleUpdate);
  let current = shell.parentElement;
  while (current) {
    if (current.style.getPropertyValue("--comments-pane-width")) {
      mutationObserver.observe(current, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    current = current.parentElement;
  }
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "aria-hidden"],
  });

  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener(COMMENTS_PANE_EVENT, scheduleUpdate);
  if (
    scrollContainer &&
    scrollContainer !== document.documentElement &&
    scrollContainer !== document.body &&
    scrollContainer !== document.scrollingElement
  ) {
    scrollContainer.addEventListener("scroll", scheduleUpdate, {
      passive: true,
    });
  }

  return () => {
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
    }
    if (
      scrollContainer &&
      scrollContainer !== document.documentElement &&
      scrollContainer !== document.body &&
      scrollContainer !== document.scrollingElement
    ) {
      scrollContainer.removeEventListener("scroll", scheduleUpdate);
    }
    window.removeEventListener(COMMENTS_PANE_EVENT, scheduleUpdate);
    window.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
  };
}

const expandIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2L2 2L2 4"/><path d="M12 2L14 2L14 4"/><path d="M4 14L2 14L2 12"/><path d="M12 14L14 14L14 12"/></svg>`;
const collapseIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2L4 2L4 4"/><path d="M14 2L12 2L12 4"/><path d="M2 14L4 14L4 12"/><path d="M14 14L12 14L12 12"/></svg>`;

function getLeftRailElement() {
  const collapsedButton = document.querySelector('[aria-label="Expand sidebar"]');
  const collapsedRail = collapsedButton?.parentElement;
  if (collapsedRail instanceof HTMLElement) {
    return collapsedRail;
  }

  const expandedButton = document.querySelector('[aria-label="Collapse sidebar"]');
  const expandedRail = expandedButton?.parentElement;
  if (expandedRail instanceof HTMLElement) {
    return expandedRail;
  }

  const asideFallback = Array.from(document.querySelectorAll("aside")).find((aside) => {
    const rect = aside.getBoundingClientRect();
    return (
      rect.width >= 40 &&
      rect.width <= 500 &&
      rect.left <= 4 &&
      rect.right < window.innerWidth / 2
    );
  });

  return asideFallback instanceof HTMLElement ? asideFallback : null;
}

function getLeftRailRect() {
  return getLeftRailElement()?.getBoundingClientRect() ?? null;
}

function getRightRailElement() {
  const rightRail = document.querySelector("aside.hidden.lg\\:flex.fixed.right-0");
  return rightRail instanceof HTMLElement ? rightRail : null;
}

function getRightRailRect() {
  return getRightRailElement()?.getBoundingClientRect() ?? null;
}

function getVerticalScrollContainer(node: HTMLElement) {
  let current: HTMLElement | null = node.parentElement;

  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
}
