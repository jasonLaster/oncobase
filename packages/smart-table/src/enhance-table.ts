import {
  defaultSmartTableLayoutAdapter,
  getDefaultVerticalScrollContainer,
  type SmartTableLayoutAdapter,
} from "./layout-adapter";
import {
  SMART_TABLE_LAYOUT_EVENT,
  attachSmartResizeHandles,
  installSmartTableLayout,
} from "./smart-table-layout";

const expandedTableMemory = new Map<string, boolean>();

export type SmartTableToggleLabels = {
  expand: string;
  collapse: string;
};

export const defaultSmartTableToggleLabels: SmartTableToggleLabels = {
  expand: "Expand table",
  collapse: "Collapse table",
};

const COLLAPSED_TOGGLE_TOP = "-0.25rem";
const EXPANDED_TOGGLE_TOP = "-2rem";

function setDefaultStyle(
  node: HTMLElement,
  property: string,
  value: string
) {
  const style = node.style as unknown as Record<string, string>;
  if (!style[property]) {
    style[property] = value;
  }
}

function shouldApplySmartTableFallbackStyles(shell: HTMLDivElement) {
  return (
    window
      .getComputedStyle(shell)
      .getPropertyValue("--smart-table-css-loaded")
      .trim() !== "1"
  );
}

function applySmartTableFallbackStyles(
  table: HTMLTableElement,
  wrapper: HTMLDivElement,
  shell: HTMLDivElement,
  button: HTMLButtonElement
) {
  setDefaultStyle(shell, "position", "relative");
  setDefaultStyle(shell, "paddingTop", "0.75rem");

  setDefaultStyle(wrapper, "position", "relative");
  setDefaultStyle(wrapper, "boxSizing", "border-box");
  setDefaultStyle(wrapper, "overflowX", "auto");
  setDefaultStyle(wrapper, "margin", "1rem 0");
  setDefaultStyle(wrapper, "paddingRight", "0");
  setDefaultStyle(
    wrapper,
    "border",
    "1px solid var(--smart-table-border-color, var(--sidebar-border, #e5e7eb))"
  );
  setDefaultStyle(wrapper, "borderRadius", "1rem");
  setDefaultStyle(
    wrapper,
    "background",
    "var(--smart-table-surface, var(--background, #ffffff))"
  );

  setDefaultStyle(table, "width", "100%");
  setDefaultStyle(table, "borderCollapse", "separate");
  setDefaultStyle(table, "borderSpacing", "0");
  setDefaultStyle(
    table,
    "color",
    "var(--smart-table-foreground, var(--foreground, #111827))"
  );

  table.querySelectorAll<HTMLElement>("th").forEach((cell) => {
    setDefaultStyle(cell, "padding", "0.8rem 0.9rem");
    setDefaultStyle(cell, "textAlign", "left");
    setDefaultStyle(cell, "verticalAlign", "middle");
    setDefaultStyle(cell, "textTransform", "uppercase");
    setDefaultStyle(cell, "letterSpacing", "0.04em");
    setDefaultStyle(cell, "fontWeight", "700");
    setDefaultStyle(cell, "fontSize", "0.78rem");
    setDefaultStyle(
      cell,
      "borderBottom",
      "1px solid var(--smart-table-border-color, var(--sidebar-border, #e5e7eb))"
    );
  });

  table.querySelectorAll<HTMLElement>("td").forEach((cell) => {
    setDefaultStyle(cell, "padding", "0.8rem 0.9rem");
    setDefaultStyle(cell, "verticalAlign", "top");
    setDefaultStyle(
      cell,
      "borderBottom",
      "1px solid color-mix(in srgb, var(--smart-table-border-color, var(--sidebar-border, #e5e7eb)) 65%, transparent)"
    );
  });

  setDefaultStyle(button, "position", "absolute");
  setDefaultStyle(button, "top", "0");
  setDefaultStyle(button, "right", "0.375rem");
  setDefaultStyle(button, "zIndex", "10");
  setDefaultStyle(button, "display", "inline-flex");
  setDefaultStyle(button, "alignItems", "center");
  setDefaultStyle(button, "justifyContent", "center");
  setDefaultStyle(button, "height", "1.75rem");
  setDefaultStyle(button, "width", "1.75rem");
  setDefaultStyle(button, "borderRadius", "0.375rem");
}

function syncOverflowFadeParent(
  fade: HTMLDivElement,
  wrapper: HTMLDivElement,
  expansionLayer: HTMLDivElement | null,
  expanded: boolean
) {
  const nextParent = expanded && expansionLayer ? expansionLayer : wrapper;
  if (fade.parentElement !== nextParent) {
    nextParent.appendChild(fade);
  }
}

function applySmartTableClasses(table: HTMLTableElement) {
  table.classList.add("smart-table");
  table.setAttribute("data-slot", "table");

  table.querySelectorAll("thead").forEach((section) => {
    section.classList.add("smart-table-header");
    section.setAttribute("data-slot", "table-header");
  });

  table.querySelectorAll("tbody").forEach((section) => {
    section.classList.add("smart-table-body");
    section.setAttribute("data-slot", "table-body");
  });

  table.querySelectorAll("tfoot").forEach((section) => {
    section.classList.add("smart-table-footer");
    section.setAttribute("data-slot", "table-footer");
  });

  table.querySelectorAll("tr").forEach((row) => {
    row.classList.add("smart-table-row");
    row.setAttribute("data-slot", "table-row");
  });

  table.querySelectorAll("th").forEach((cell) => {
    cell.classList.add("smart-table-head-cell");
    cell.setAttribute("data-slot", "table-head");
  });

  table.querySelectorAll("td").forEach((cell) => {
    cell.classList.add("smart-table-cell");
    cell.setAttribute("data-slot", "table-cell");
  });

  table.querySelectorAll("caption").forEach((caption) => {
    caption.classList.add("smart-table-caption");
    caption.setAttribute("data-slot", "table-caption");
  });
}

export function enhanceSmartTableElement(
  table: HTMLTableElement,
  options: {
    persistenceKey?: string;
    layoutAdapter?: SmartTableLayoutAdapter;
    toggleLabels?: Partial<SmartTableToggleLabels>;
  } = {}
) {
  const layoutAdapter = options.layoutAdapter ?? defaultSmartTableLayoutAdapter;
  const labels = {
    ...defaultSmartTableToggleLabels,
    ...options.toggleLabels,
  };
  const existingWrapper = table.parentElement?.classList.contains(
    "table-scroll-wrapper"
  )
    ? (table.parentElement as HTMLDivElement)
    : null;
  const existingShell = existingWrapper?.parentElement?.hasAttribute(
    "data-smart-table-shell"
  )
    ? (existingWrapper.parentElement as HTMLDivElement)
    : null;

  const wrapper = existingWrapper ?? document.createElement("div");
  const shell = existingShell ?? document.createElement("div");

  if (!existingShell) {
    shell.setAttribute("data-smart-table-shell", "");
    shell.className = "smart-table-shell";
  } else {
    shell.classList.add("smart-table-shell");
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
    wrapper.className = "smart-table-wrapper table-scroll-wrapper";
    if (!existingShell) {
      table.parentNode?.insertBefore(shell, table);
    }
    shell.appendChild(wrapper);
    wrapper.appendChild(table);
  } else {
    wrapper.classList.add("smart-table-wrapper", "table-scroll-wrapper");
    if (!existingShell) {
      wrapper.parentNode?.insertBefore(shell, wrapper);
      shell.appendChild(wrapper);
    }
  }

  wrapper.setAttribute("data-smart-table-wrapper", "");
  applySmartTableClasses(table);

  const layoutCleanup = installSmartTableLayout(table, wrapper, {
    persistenceKey: options.persistenceKey,
  });
  const resizeCleanup = attachSmartResizeHandles(table, {
    persistenceKey: options.persistenceKey,
  });

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

    updateOverflowFade();
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

  let syncFrame = 0;
  const scheduleExpandedLayoutSync = () => {
    if (syncFrame !== 0) {
      return;
    }

    syncFrame = window.requestAnimationFrame(() => {
      syncFrame = 0;
      syncExpandedLayout();
    });
  };

  const onWheel = (event: WheelEvent) => {
    if (!expanded) {
      return;
    }

    const scrollOwner =
      layoutAdapter.getVerticalScrollContainer?.(shell) ??
      getDefaultVerticalScrollContainer(shell);
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

  const resizeObserver = new ResizeObserver(scheduleExpandedLayoutSync);
  resizeObserver.observe(wrapper);
  table.addEventListener(SMART_TABLE_LAYOUT_EVENT, scheduleExpandedLayoutSync);

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", labels.expand);
  button.title = labels.expand;
  button.dataset.smartTableToggle = "true";
  button.innerHTML = expandIcon;
  if (shouldApplySmartTableFallbackStyles(shell)) {
    applySmartTableFallbackStyles(table, wrapper, shell, button);
  }

  const overflowFade = document.createElement("div");
  overflowFade.className = "smart-table-overflow-fade";
  overflowFade.setAttribute("aria-hidden", "true");
  wrapper.setAttribute("data-smart-table-fade-managed", "");

  let expanded = false;
  let expandedCleanup: (() => void) | null = null;
  let expansionLayer: HTMLDivElement | null = null;
  let shellOffsetTop = 0;
  let restoreFrame = 0;
  let destroyed = false;

  const shouldUseExpansionOverlay = () =>
    layoutAdapter.shouldUseOverlay?.() ?? false;

  const updateButtonVisibility = () => {
    button.style.display = shouldUseExpansionOverlay() ? "" : "none";
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

  const updateButtonPlacement = () => {
    button.className = expanded
      ? "smart-table-toggle smart-table-toggle--expanded"
      : "smart-table-toggle";
    button.style.top = expanded ? EXPANDED_TOGGLE_TOP : COLLAPSED_TOGGLE_TOP;
    button.style.right = "0.375rem";

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

  const updateOverflowFade = () => {
    syncOverflowFadeParent(overflowFade, wrapper, expansionLayer, expanded);

    const shouldShow =
      wrapper.hasAttribute("data-scrollable") &&
      !wrapper.hasAttribute("data-scrolled-end");

    overflowFade.hidden = !shouldShow;
    overflowFade.className = expanded
      ? "smart-table-overflow-fade smart-table-overflow-fade--overlay"
      : "smart-table-overflow-fade";

    if (!shouldShow) {
      overflowFade.style.removeProperty("top");
      overflowFade.style.removeProperty("height");
      return;
    }

    if (expanded && expansionLayer) {
      const wrapperRect = wrapper.getBoundingClientRect();
      const layerRect = expansionLayer.getBoundingClientRect();
      overflowFade.style.top = `${Math.max(0, wrapperRect.top - layerRect.top)}px`;
      overflowFade.style.height = `${Math.ceil(wrapperRect.height)}px`;
      return;
    }

    overflowFade.style.top = "0";
    overflowFade.style.height = "100%";
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
    updateOverflowFade();
  };

  const syncCollapsedStateForNarrowViewport = () => {
    if (shouldUseExpansionOverlay() || !expanded) {
      return;
    }

    expanded = false;
    persistExpandedPreference(false);
    button.innerHTML = expandIcon;
    button.setAttribute("aria-label", labels.expand);
    button.title = labels.expand;
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

    const layout =
      layoutAdapter.getOverlayLayout?.({
        wrapper,
        shell,
        shellOffsetTop,
      }) ?? null;
    if (!layout) {
      return;
    }

    if (!expansionLayer) {
      expansionLayer = document.createElement("div");
      expansionLayer.className = "smart-table-overlay table-expansion-layer";
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
    if (
      !expansionLayer.isConnected ||
      expansionLayer.parentElement !== layout.parent
    ) {
      layout.parent.appendChild(expansionLayer);
    }

    wrapper.style.width = "100%";
    wrapper.style.margin = "0";
    if (wrapper.parentElement !== expansionLayer) {
      expansionLayer.appendChild(wrapper);
    }

    updateButtonPlacement();
    updateReservedHeight();
    updateOverflowFade();
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
    button.setAttribute(
      "aria-label",
      expanded ? labels.collapse : labels.expand
    );
    button.title = expanded ? labels.collapse : labels.expand;

    if (expanded) {
      persistExpandedPreference(true);
      applyExpansionLayout();
      expandedCleanup =
        layoutAdapter.observeOverlayLayout?.({
          wrapper,
          shell,
          onLayout: () => {
            applyExpansionLayout();
          },
        }) ??
        observeViewportOverlayLayout(wrapper, shell, () => {
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
    shell,
    wrapper,
    cleanup: () => {
      if (restoreFrame !== 0) {
        window.cancelAnimationFrame(restoreFrame);
        restoreFrame = 0;
      }
      if (syncFrame !== 0) {
        window.cancelAnimationFrame(syncFrame);
        syncFrame = 0;
      }
      collapseExpansion();
      destroyed = true;
      button.removeEventListener("click", toggle);
      button.remove();
      overflowFade.remove();
      wrapper.removeAttribute("data-smart-table-fade-managed");
      wrapper.removeEventListener("scroll", onScroll);
      wrapper.removeEventListener("wheel", onWheel);
      table.removeEventListener(SMART_TABLE_LAYOUT_EVENT, scheduleExpandedLayoutSync);
      resizeObserver.disconnect();
      resizeCleanup();
      layoutCleanup();

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

function observeViewportOverlayLayout(
  wrapper: HTMLElement,
  shell: HTMLElement,
  onLayout: () => void
) {
  const scrollContainer = getDefaultVerticalScrollContainer(shell);
  let frame = 0;

  const scheduleUpdate = () => {
    if (frame !== 0) {
      return;
    }

    frame = window.requestAnimationFrame(() => {
      frame = 0;
      onLayout();
    });
  };

  const resizeObserver = new ResizeObserver(scheduleUpdate);
  resizeObserver.observe(wrapper);
  resizeObserver.observe(shell);

  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
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
    window.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    resizeObserver.disconnect();
  };
}

const expandIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2L2 2L2 4"/><path d="M12 2L14 2L14 4"/><path d="M4 14L2 14L2 12"/><path d="M12 14L14 14L14 12"/></svg>`;
const collapseIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2L4 2L4 4"/><path d="M14 2L12 2L12 4"/><path d="M2 14L4 14L4 12"/><path d="M14 14L12 14L12 12"/></svg>`;
