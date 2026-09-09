import { createElement as h } from "react";

/** The original reader's compact page-copy glyph, also used by the HTML shell. */
export function CopyPageIcon() {
  return h("svg", { "aria-hidden": true, width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
    h("rect", { x: 5, y: 5, width: 8, height: 8, rx: 1 }),
    h("path", { d: "M3 11V3a1 1 0 0 1 1-1h8" }));
}
