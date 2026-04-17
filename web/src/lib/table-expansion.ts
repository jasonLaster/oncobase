type TableBleed = {
  marginLeft: number;
  marginRight: number;
};

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

export function getExpandedTableBleed(
  wrapper: HTMLElement,
  shell: HTMLElement
): TableBleed | null {
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

export function clearExpandedTableBleed(wrapper: HTMLElement) {
  wrapper.style.marginLeft = "";
  wrapper.style.marginRight = "";
}

export function observeExpandedTableBleed(
  wrapper: HTMLElement,
  shell: HTMLElement,
  onBleed: (bleed: TableBleed | null) => void
) {
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
      onBleed(getExpandedTableBleed(wrapper, shell));
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
}
