/** localStorage key holding the reader sidebar's width in px; 0 means collapsed. */
export const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar-width";
/** Custom property on <html> that sizes the expanded sidebar rail. */
export const SIDEBAR_WIDTH_VARIABLE = "--wiki-sidebar-width";
export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_MAX_WIDTH = 480;

/**
 * The saved sidebar preference, applied to <html> before the first paint:
 * `data-initial-sidebar-state` (styles.css shows the collapsed rail over an
 * expanded render) and the rail width variable. Markup therefore never
 * carries a per-user width, so a server-rendered shell matches every
 * visitor's and nothing shifts when the client takes over.
 *
 * Serialized into the document head by source (apps/app/vite.config.ts), so
 * it must stay self-contained: no imports, no references outside itself.
 */
export function installSidebarStartupState() {
  try {
    // Serialized into the document head, so it cannot import safe-storage;
    // the surrounding try/catch is its guard against blocked storage.
    // eslint-disable-next-line no-restricted-properties
    const stored = window.localStorage.getItem("sidebar-width");
    if (stored === null) return;
    const width = Number.parseInt(stored, 10);
    // Same validation as the layout's own reader (resizable-layout.tsx).
    if (!Number.isFinite(width) || width < 0 || width > 480) return;
    const root = document.documentElement;
    root.dataset.initialSidebarState = width === 0 ? "collapsed" : "expanded";
    if (width > 0) root.style.setProperty("--wiki-sidebar-width", `${width}px`);
  } catch {
    // Storage can be blocked; the layout applies the default.
  }
}
