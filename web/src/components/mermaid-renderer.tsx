"use client";

import { useEffect, useRef } from "react";

/**
 * Client island that progressively enhances server-rendered mermaid placeholders.
 * The server pipeline converts ```mermaid fences into:
 *   <div class="mermaid-placeholder" data-graph="<base64>"></div>
 * This component finds those divs and replaces them with rendered SVGs.
 */
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
        theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
        fontFamily: "inherit",
        flowchart: { curve: "basis", padding: 20 },
        themeVariables: {
          fontSize: "14px",
        },
      });

      if (cancelled) return;

      let idx = 0;
      for (const placeholder of Array.from(placeholders)) {
        const encoded = placeholder.getAttribute("data-graph");
        if (!encoded) continue;

        let graph: string;
        try {
          graph = atob(encoded);
        } catch {
          continue;
        }

        const id = `mermaid-diagram-${idx++}`;
        try {
          const { svg } = await mermaid.render(id, graph);
          if (cancelled) return;

          const wrapper = document.createElement("div");
          wrapper.className = "mermaid-diagram my-6 overflow-x-auto";
          wrapper.innerHTML = svg;
          placeholder.replaceWith(wrapper);
        } catch (err) {
          console.warn("Mermaid render error:", err);
          const errDiv = document.createElement("div");
          errDiv.className = "mermaid-error text-sm text-red-500 font-mono whitespace-pre-wrap my-4 p-3 border border-red-200 rounded";
          errDiv.textContent = `Mermaid render failed:\n${graph}`;
          placeholder.replaceWith(errDiv);
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, []);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}
