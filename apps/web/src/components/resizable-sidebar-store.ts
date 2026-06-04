"use client";

export const RESIZABLE_SIDEBAR_MIN_WIDTH = 160;
export const RESIZABLE_SIDEBAR_MAX_WIDTH = 480;
export const RESIZABLE_SIDEBAR_DEFAULT_WIDTH = 256;

const STORAGE_KEY = "sidebar-width";
let listeners: Array<() => void> = [];
let widthCache: number | null = null;

function readStoredWidth() {
  if (typeof window === "undefined") return RESIZABLE_SIDEBAR_DEFAULT_WIDTH;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const nextWidth = parseInt(stored, 10);
    if (nextWidth >= 0 && nextWidth <= RESIZABLE_SIDEBAR_MAX_WIDTH) {
      return nextWidth;
    }
  }

  return RESIZABLE_SIDEBAR_DEFAULT_WIDTH;
}

function syncInitialSidebarState(width: number) {
  if (typeof window === "undefined") return;

  window.document.documentElement.dataset.initialSidebarState =
    width === 0 ? "collapsed" : "expanded";
}

export function subscribeToResizableSidebar(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  listeners.push(onStoreChange);

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;

    widthCache = null;
    syncInitialSidebarState(readStoredWidth());
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((listener) => listener !== onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function getResizableSidebarSnapshot() {
  if (typeof window === "undefined") return RESIZABLE_SIDEBAR_DEFAULT_WIDTH;

  if (widthCache !== null) {
    return widthCache;
  }

  widthCache = readStoredWidth();
  return widthCache;
}

export function getResizableSidebarServerSnapshot() {
  return RESIZABLE_SIDEBAR_DEFAULT_WIDTH;
}

export function setResizableSidebarWidth(
  nextWidth: number,
  options?: {
    persist?: boolean;
  },
) {
  if (typeof window === "undefined") return;

  widthCache = nextWidth;
  syncInitialSidebarState(nextWidth);

  if (options?.persist ?? true) {
    window.localStorage.setItem(STORAGE_KEY, String(nextWidth));
  }

  listeners.forEach((listener) => listener());
}
