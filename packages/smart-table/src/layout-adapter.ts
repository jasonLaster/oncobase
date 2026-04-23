export type SmartTableBleed = {
  marginLeft: number;
  marginRight: number;
};

export type SmartTableOverlayLayout = {
  left: number;
  top: number;
  width: number;
  parent: HTMLElement;
};

type SmartTableElementContext = {
  wrapper: HTMLElement;
  shell: HTMLElement;
};

type SmartTableOverlayContext = SmartTableElementContext & {
  shellOffsetTop: number;
};

type SmartTableObserveBleedContext = SmartTableElementContext & {
  onBleed: (bleed: SmartTableBleed | null) => void;
};

type SmartTableObserveOverlayContext = SmartTableElementContext & {
  onLayout: () => void;
};

export interface SmartTableLayoutAdapter {
  shouldUseOverlay?: () => boolean;
  getVerticalScrollContainer?: (node: HTMLElement) => HTMLElement;
  getExpandedBleed?: (context: SmartTableElementContext) => SmartTableBleed | null;
  observeExpandedBleed?: (
    context: SmartTableObserveBleedContext
  ) => () => void;
  getOverlayLayout?: (
    context: SmartTableOverlayContext
  ) => SmartTableOverlayLayout | null;
  observeOverlayLayout?: (
    context: SmartTableObserveOverlayContext
  ) => () => void;
}

export function getDefaultVerticalScrollContainer(node: HTMLElement) {
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

function observeViewportOverlayLayout({
  shell,
  wrapper,
  onLayout,
  getVerticalScrollContainer,
}: SmartTableObserveOverlayContext & {
  getVerticalScrollContainer: (node: HTMLElement) => HTMLElement;
}) {
  const scrollContainer = getVerticalScrollContainer(shell);
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
  resizeObserver.observe(shell);
  resizeObserver.observe(wrapper);

  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
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

    window.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    resizeObserver.disconnect();
  };
}

export function createViewportSmartTableLayoutAdapter(options: {
  desktopMinWidth?: number;
  viewportPadding?: number;
  parent?: () => HTMLElement;
} = {}): SmartTableLayoutAdapter {
  const {
    desktopMinWidth = 1024,
    viewportPadding = 24,
    parent = () => document.body,
  } = options;

  return {
    shouldUseOverlay() {
      return window.matchMedia(`(min-width: ${desktopMinWidth}px)`).matches;
    },
    getVerticalScrollContainer: getDefaultVerticalScrollContainer,
    getExpandedBleed() {
      return null;
    },
    observeExpandedBleed() {
      return () => {};
    },
    getOverlayLayout({ shell, shellOffsetTop }) {
      const shellRect = shell.getBoundingClientRect();
      const left = viewportPadding;
      const right = window.innerWidth - viewportPadding;
      const width = right - left;

      if (width <= 0) {
        return null;
      }

      return {
        parent: parent(),
        left,
        top: shellRect.top + shellOffsetTop,
        width,
      };
    },
    observeOverlayLayout(context) {
      return observeViewportOverlayLayout({
        ...context,
        getVerticalScrollContainer:
          getDefaultVerticalScrollContainer,
      });
    },
  };
}

export const defaultSmartTableLayoutAdapter =
  createViewportSmartTableLayoutAdapter();
