"use client";

import { useEffect, useRef } from "react";

/**
 * Client island that renders server-side mermaid placeholders.
 * The server pipeline converts ```mermaid fences into:
 *   <div class="mermaid-placeholder" data-graph="<base64>"></div>
 *
 * UTF-8 note: Buffer.from(str).toString("base64") encodes UTF-8 bytes.
 * `atob` decodes as Latin-1, so we must go through TextDecoder to recover
 * multi-byte characters (–, ×, ·, ⚠ etc.)
 */
function base64ToUtf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// Light-mode palette mapped from common dark-mode fills used in the wiki diagrams
const FILL_MAP: Record<string, string> = {
  // dark blue → soft blue
  "#1e3a5f": "#dbeafe", "#3d6a9e": "#93c5fd",
  // dark green → soft green
  "#1a4a2a": "#dcfce7", "#2d4a2d": "#dcfce7", "#276749": "#86efac",
  // dark amber → soft amber
  "#744210": "#fef9c3", "#975a16": "#fde68a",
  // dark red → soft red
  "#742a2a": "#fee2e2", "#9b2c2c": "#fca5a5",
  // dark gray → light gray
  "#2d3748": "#f1f5f9", "#4a5568": "#cbd5e1",
};

// Light text colours used on dark fills → readable dark equivalents
const TEXT_MAP: Record<string, string> = {
  "#e8f0fe": "#1e3a5f",
  "#c6f6d5": "#166534",
  "#fefcbf": "#713f12",
  "#fed7d7": "#991b1b",
};

function normalisePalette(graph: string): string {
  let g = graph;
  for (const [dark, light] of Object.entries(FILL_MAP)) {
    // Case-insensitive replace; hex values appear lowercase in the source
    g = g.split(dark).join(light);
    g = g.split(dark.toUpperCase()).join(light);
  }
  for (const [lightText, darkText] of Object.entries(TEXT_MAP)) {
    g = g.split(lightText).join(darkText);
  }
  return g;
}

export function MermaidRenderer() {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prose = sentinelRef.current?.parentElement;
    if (!prose) return;

    const placeholders = prose.querySelectorAll<HTMLDivElement>(".mermaid-placeholder");
    if (placeholders.length === 0) return;

    let cancelled = false;

    async function render() {
      const { default: mermaid } = await import("mermaid");

      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        flowchart: {
          curve: "basis",
          padding: 20,
          htmlLabels: true,
          useMaxWidth: false,
        },
        themeVariables: {
          fontSize: "13.5px",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          // Base palette (overridden per-node by normalised style directives)
          primaryColor: "#f0f4ff",
          primaryTextColor: "#1a1a2e",
          primaryBorderColor: "#c7d2fe",
          lineColor: "#9ca3af",
          edgeLabelBackground: "#ffffff",
          // Soften decision diamonds
          tertiaryColor: "#f8fafc",
          tertiaryBorderColor: "#e2e8f0",
          tertiaryTextColor: "#374151",
        },
      });

      if (cancelled) return;

      let idx = 0;
      for (const placeholder of Array.from(placeholders)) {
        const encoded = placeholder.getAttribute("data-graph");
        if (!encoded) continue;

        let graph: string;
        try {
          graph = normalisePalette(base64ToUtf8(encoded));
        } catch {
          continue;
        }

        const id = `mermaid-diagram-${idx++}`;
        try {
          const { svg } = await mermaid.render(id, graph);
          if (cancelled) return;

          const wrapper = document.createElement("div");
          wrapper.className = "mermaid-diagram";
          wrapper.innerHTML = svg;

          // Let the SVG scale to fill its container while preserving aspect ratio
          const svgEl = wrapper.querySelector("svg");
          if (svgEl) {
            const intrinsicWidth = svgEl.getAttribute("width");
            if (intrinsicWidth) {
              svgEl.setAttribute("data-intrinsic-width", intrinsicWidth);
            }
            svgEl.removeAttribute("width");
            svgEl.style.width = "100%";
            svgEl.style.height = "auto";
          }

          placeholder.replaceWith(wrapper);
        } catch (err) {
          console.warn("Mermaid render error:", err);
          const errDiv = document.createElement("div");
          errDiv.className =
            "mermaid-error text-sm text-red-500 font-mono whitespace-pre-wrap my-4 p-3 border border-red-200 rounded";
          errDiv.textContent = `Mermaid render failed:\n${graph}`;
          placeholder.replaceWith(errDiv);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, []);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}
