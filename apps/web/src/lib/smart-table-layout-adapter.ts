import {
  getDefaultVerticalScrollContainer,
  type SmartTableBleed,
  type SmartTableLayoutAdapter,
} from "@oncobase/smart-table/layout-adapter";

const COMMENTS_PANE_EVENT = "comments-pane-state-change";

function getScrollContainer(wrapper: HTMLElement, shell: HTMLElement) {
  const scrollParent =
    wrapper.closest("[class*='overflow-y-auto']") ||
    wrapper
      .closest("[class*='overflow-hidden']")
      ?.querySelector("[class*='overflow-y-auto']");
  const fallbackContainer = shell.parentElement;

  return scrollParent || fallbackContainer;
}

function getBleedMutationTargets(shell: HTMLElement) {
  const targets = new Set<HTMLElement>();
  const contentWrapper = shell.closest(".comments-content-wrapper");

  if (contentWrapper instanceof HTMLElement) {
    targets.add(contentWrapper);
  }

  let current = shell.parentElement;
  while (current) {
    if (current.style.getPropertyValue("--comments-pane-width")) {
      targets.add(current);
    }
    current = current.parentElement;
  }

  return Array.from(targets);
}

function isMeasurableElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function getExpandedBleed(
  wrapper: HTMLElement,
  shell: HTMLElement
): SmartTableBleed | null {
  const container = getScrollContainer(wrapper, shell);

  if (!container) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const contentWrapper = shell.closest(".comments-content-wrapper");

  let usableLeft = containerRect.left;
  let usableRight = containerRect.right;

  if (contentWrapper instanceof HTMLElement) {
    const contentWrapperRect = contentWrapper.getBoundingClientRect();
    const contentWrapperStyle = window.getComputedStyle(contentWrapper);
    const paddingLeft = Number.parseFloat(contentWrapperStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(contentWrapperStyle.paddingRight) || 0;

    usableLeft = Math.max(usableLeft, contentWrapperRect.left + paddingLeft);
    usableRight = Math.min(usableRight, contentWrapperRect.right - paddingRight);
  }

  return {
    marginLeft: -(wrapperRect.left - usableLeft),
    marginRight: -(usableRight - wrapperRect.right),
  };
}

function getLeftRailElement() {
  const collapsedButton = document.querySelector('[aria-label="Expand sidebar"]');
  const collapsedRail = collapsedButton?.parentElement;
  if (collapsedRail instanceof HTMLElement && isMeasurableElement(collapsedRail)) {
    return collapsedRail;
  }

  const expandedButton = document.querySelector('[aria-label="Collapse sidebar"]');
  const expandedRail = expandedButton?.parentElement;
  if (expandedRail instanceof HTMLElement && isMeasurableElement(expandedRail)) {
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

function getRightRailElement() {
  const rightRail = document.querySelector("aside.hidden.lg\\:flex.fixed.right-0");
  return rightRail instanceof HTMLElement ? rightRail : null;
}

export const webSmartTableLayoutAdapter: SmartTableLayoutAdapter = {
  shouldUseOverlay() {
    return window.matchMedia("(min-width: 1024px)").matches;
  },
  getVerticalScrollContainer: getDefaultVerticalScrollContainer,
  getExpandedBleed({ wrapper, shell }) {
    return getExpandedBleed(wrapper, shell);
  },
  observeExpandedBleed({ wrapper, shell, onBleed }) {
    const container = getScrollContainer(wrapper, shell);
    const contentWrapper = shell.closest(".comments-content-wrapper");
    const resizeTargets = new Set<HTMLElement>();

    if (container instanceof HTMLElement) {
      resizeTargets.add(container);
    }

    if (contentWrapper instanceof HTMLElement) {
      resizeTargets.add(contentWrapper);
    }

    let frame = 0;

    const scheduleUpdate = () => {
      if (frame !== 0) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        onBleed(getExpandedBleed(wrapper, shell));
      });
    };

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeTargets.forEach((target) => resizeObserver.observe(target));

    const mutationObserver = new MutationObserver(scheduleUpdate);
    getBleedMutationTargets(shell).forEach((target) => {
      mutationObserver.observe(target, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    });

    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }

      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  },
  getOverlayLayout({ shell, shellOffsetTop }) {
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

    const leftRect = getLeftRailElement()?.getBoundingClientRect() ?? null;
    const rightRect = getRightRailElement()?.getBoundingClientRect() ?? null;
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
  },
  observeOverlayLayout({ wrapper, shell, onLayout }) {
    const contentWrapper = shell.closest(".comments-content-wrapper");
    const scrollContainer = getDefaultVerticalScrollContainer(shell);

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
      const nextTargets = new Set<HTMLElement>([shell, wrapper]);

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
  },
};
