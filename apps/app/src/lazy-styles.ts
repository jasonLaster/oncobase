// Styles for routes and late UI. The eager stylesheet carries only what the
// reader's first paint needs; a route imports its stylesheet with `?inline`
// and adopts it when its chunk loads, before React renders anything from it.
// The CSS ships inside that JS chunk, so there is no separate CSS request to
// fail (the reason for cssCodeSplit: false in vite.config.ts).
//
// These sheets came last in the old merged stylesheet, in the order below.
// Adopted sheets go after the eager stylesheet and keep that relative order
// whichever loads first, so the cascade matches the merged file.
const ORDER = ["education", "page-sharing", "pathology", "pdf-viewer", "cellularity", "marketing"] as const;

export type LazyStylesId = (typeof ORDER)[number];

export function adoptStyles(id: LazyStylesId, css: string) {
  if (typeof document === "undefined" || document.head.querySelector(`style[data-lazy-styles="${id}"]`)) return;
  const style = document.createElement("style");
  style.dataset.lazyStyles = id;
  style.textContent = css;
  const later = [...document.head.querySelectorAll<HTMLStyleElement>("style[data-lazy-styles]")]
    .find((other) => ORDER.indexOf(other.dataset.lazyStyles as LazyStylesId) > ORDER.indexOf(id));
  document.head.insertBefore(style, later ?? null);
}
