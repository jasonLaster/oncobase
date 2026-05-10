import {
  getDefaultVerticalScrollContainer,
  type SmartTableLayoutAdapter,
} from "@diana-tnbc/smart-table";

const OUTLINE_STATE_EVENT = "wiki-vite:outline-state-change";
const GUTTER = 20;

function isVisibleElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function getLeftRailElement() {
  const expanded = document.querySelector("[data-sidebar-expanded-rail]");
  if (isVisibleElement(expanded)) return expanded;

  const collapsed = document.querySelector("[data-sidebar-collapsed-rail]");
  if (isVisibleElement(collapsed)) return collapsed;

  return null;
}

function getRightRailElement() {
  const outline = document.querySelector('[data-test-id="page-outline"]');
  if (isVisibleElement(outline)) return outline;
  return null;
}

function getContentBounds(shell: HTMLElement) {
  const contentShell = shell.closest(".content-shell");
  const pageLayout = shell.closest(".page-layout");
  const fallback = shell.getBoundingClientRect();
  const element = pageLayout instanceof HTMLElement ? pageLayout : contentShell;
  const rect = element instanceof HTMLElement ? element.getBoundingClientRect() : fallback;
  const style = element instanceof HTMLElement ? window.getComputedStyle(element) : null;
  return {
    left: rect.left + (style ? Number.parseFloat(style.paddingLeft) || 0 : 0),
    right: rect.right - (style ? Number.parseFloat(style.paddingRight) || 0 : 0),
  };
}

function scheduleAnimationFrame(callback: () => void) {
  let frame = 0;
  return {
    schedule() {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        callback();
      });
    },
    cancel() {
      if (frame === 0) return;
      window.cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

export function dispatchOutlineStateChange() {
  window.dispatchEvent(new Event(OUTLINE_STATE_EVENT));
}

export const wikiViteSmartTableLayoutAdapter: SmartTableLayoutAdapter = {
  shouldUseOverlay() {
    return window.matchMedia("(min-width: 1024px)").matches;
  },
  getVerticalScrollContainer: getDefaultVerticalScrollContainer,
  getOverlayLayout({ shell, shellOffsetTop }) {
    const shellRect = shell.getBoundingClientRect();
    const contentBounds = getContentBounds(shell);
    const leftRail = getLeftRailElement()?.getBoundingClientRect() ?? null;
    const rightRail = getRightRailElement()?.getBoundingClientRect() ?? null;
    const left = leftRail ? leftRail.right + GUTTER : contentBounds.left;
    const right = rightRail ? rightRail.left - GUTTER : contentBounds.right;
    const width = right - left;

    if (width <= 0) return null;

    return {
      parent: document.body,
      left,
      top: shellRect.top + shellOffsetTop,
      width,
    };
  },
  observeOverlayLayout({ wrapper, shell, onLayout }) {
    const scheduler = scheduleAnimationFrame(() => {
      syncResizeTargets();
      onLayout();
    });
    const resizeObserver = new ResizeObserver(scheduler.schedule);
    let observedTargets = new Set<HTMLElement>();

    const syncResizeTargets = () => {
      const nextTargets = new Set<HTMLElement>([shell, wrapper]);
      const contentShell = shell.closest(".content-shell");
      const pageLayout = shell.closest(".page-layout");
      const leftRail = getLeftRailElement();
      const rightRail = getRightRailElement();

      if (contentShell instanceof HTMLElement) nextTargets.add(contentShell);
      if (pageLayout instanceof HTMLElement) nextTargets.add(pageLayout);
      if (leftRail) nextTargets.add(leftRail);
      if (rightRail) nextTargets.add(rightRail);

      observedTargets.forEach((target) => {
        if (!nextTargets.has(target)) resizeObserver.unobserve(target);
      });
      nextTargets.forEach((target) => {
        if (!observedTargets.has(target)) resizeObserver.observe(target);
      });
      observedTargets = nextTargets;
    };

    syncResizeTargets();

    const mutationObserver = new MutationObserver(scheduler.schedule);
    mutationObserver.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class", "style", "data-sidebar-state", "data-outline-state"],
    });

    const scrollContainer = getDefaultVerticalScrollContainer(shell);
    window.addEventListener("resize", scheduler.schedule);
    window.addEventListener("scroll", scheduler.schedule, { passive: true });
    window.addEventListener(OUTLINE_STATE_EVENT, scheduler.schedule);
    if (
      scrollContainer !== document.documentElement &&
      scrollContainer !== document.body &&
      scrollContainer !== document.scrollingElement
    ) {
      scrollContainer.addEventListener("scroll", scheduler.schedule, { passive: true });
    }

    return () => {
      scheduler.cancel();
      if (
        scrollContainer !== document.documentElement &&
        scrollContainer !== document.body &&
        scrollContainer !== document.scrollingElement
      ) {
        scrollContainer.removeEventListener("scroll", scheduler.schedule);
      }
      window.removeEventListener(OUTLINE_STATE_EVENT, scheduler.schedule);
      window.removeEventListener("scroll", scheduler.schedule);
      window.removeEventListener("resize", scheduler.schedule);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  },
};
