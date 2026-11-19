import css from "@liveblocks/react-ui/styles.css?inline";

// Liveblocks' comment UI styles (~10 KiB gzip) load with the comments chunk
// instead of the reader's eager stylesheet. In that merged stylesheet they came
// before the app's own rules, so they go in ahead of the first stylesheet to
// keep app rules winning ties.
if (typeof document !== "undefined" && !document.head.querySelector('style[data-lazy-styles="liveblocks"]')) {
  const style = document.createElement("style");
  style.dataset.lazyStyles = "liveblocks";
  style.textContent = css;
  document.head.insertBefore(style, document.head.querySelector('link[rel="stylesheet"], style'));
}
