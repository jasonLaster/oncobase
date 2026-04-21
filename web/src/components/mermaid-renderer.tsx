"use client";

import { useEffect, useRef } from "react";

function base64ToUtf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

const FILL_MAP: Record<string, string> = {
  "#1e3a5f": "#dbeafe",
  "#3d6a9e": "#93c5fd",
  "#1a4a2a": "#dcfce7",
  "#2d4a2d": "#dcfce7",
  "#276749": "#86efac",
  "#744210": "#fef9c3",
  "#975a16": "#fde68a",
  "#742a2a": "#fee2e2",
  "#9b2c2c": "#fca5a5",
  "#2d3748": "#f1f5f9",
  "#4a5568": "#cbd5e1",
};

const TEXT_MAP: Record<string, string> = {
  "#e8f0fe": "#1e3a5f",
  "#c6f6d5": "#166534",
  "#fefcbf": "#713f12",
  "#fed7d7": "#991b1b",
};

function normalisePalette(graph: string): string {
  let g = graph;
  for (const [dark, light] of Object.entries(FILL_MAP)) {
    g = g.split(dark).join(light);
    g = g.split(dark.toUpperCase()).join(light);
  }
  for (const [lightText, darkText] of Object.entries(TEXT_MAP)) {
    g = g.split(lightText).join(darkText);
  }
  return g;
}

type Scheme = "light" | "dark";

const FONT_STACK =
  'Geist, "Geist Fallback", ui-sans-serif, system-ui, -apple-system, sans-serif';

type GanttMarker = { date: string; label: string; color?: string };

// Reference year for axis ticks (matches the `dateFormat YYYY-MM-DD` in the
// gantt source). Kept conservative so the parser doesn't need full locale
// handling just to interpolate a marker position.
const AXIS_REFERENCE_YEAR = 2026;
const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseIso(d: string): number {
  const [y, m, day] = d.split("-").map((s) => Number(s));
  return Date.UTC(y, m - 1, day);
}

function parseAxisTick(text: string | null | undefined): number | null {
  if (!text) return null;
  // mermaid axisFormat "%b %d" yields e.g. "Apr 12" (optional leading space)
  const m = text.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (month == null) return null;
  return Date.UTC(AXIS_REFERENCE_YEAR, month, Number(m[2]));
}

function injectGanttMarkers(svg: SVGSVGElement, markers: GanttMarker[]): void {
  const ticks = svg.querySelectorAll<SVGGElement>("g.grid g.tick");
  if (ticks.length < 2) return;

  const points: { x: number; t: number }[] = [];
  ticks.forEach((tick) => {
    const tr = tick.getAttribute("transform") ?? "";
    const xm = tr.match(/translate\(([-\d.]+)/);
    const x = xm ? Number(xm[1]) : NaN;
    const t = parseAxisTick(tick.querySelector("text")?.textContent);
    if (Number.isFinite(x) && t != null) points.push({ x, t });
  });
  if (points.length < 2) return;

  // Gantt grid is the bottom axis; transform translates the grid group to its
  // baseline. We want markers that span vertically from top to bottom of the
  // charting area.
  const grid = svg.querySelector<SVGGElement>("g.grid");
  if (!grid) return;
  const gridTr = grid.getAttribute("transform") ?? "";
  const gridM = gridTr.match(/translate\(([-\d.]+)\s*,\s*([-\d.]+)/);
  const gridOffsetX = gridM ? Number(gridM[1]) : 0;
  const gridBaselineY = gridM ? Number(gridM[2]) : 0;

  const vb = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);

  // Chart top = mermaid's top padding (title + header). Approximate from title
  // baseline if present, otherwise fall back to a fixed inset.
  const title = svg.querySelector<SVGTextElement>("text.titleText");
  const titleY = title ? Number(title.getAttribute("y") || "0") : 0;
  const chartTopY = Math.max(titleY + 12, 36);

  const ns = "http://www.w3.org/2000/svg";
  const markerGroup = document.createElementNS(ns, "g");
  markerGroup.setAttribute("class", "gantt-markers");

  for (const marker of markers) {
    const targetT = parseIso(marker.date);
    if (!Number.isFinite(targetT)) continue;

    // Linear-interpolate between nearest tick points.
    let before = points[0];
    let after = points[points.length - 1];
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].t <= targetT && points[i + 1].t >= targetT) {
        before = points[i];
        after = points[i + 1];
        break;
      }
    }
    const span = after.t - before.t || 1;
    const ratio = (targetT - before.t) / span;
    const localX = before.x + ratio * (after.x - before.x);
    const x = gridOffsetX + localX;

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    line.setAttribute("y1", String(chartTopY));
    line.setAttribute("y2", String(gridBaselineY));
    line.setAttribute("class", "gantt-marker-line");
    if (marker.color) line.setAttribute("stroke", marker.color);
    markerGroup.appendChild(line);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(Math.max(chartTopY - 6, 18)));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "gantt-marker-label");
    if (marker.color) label.setAttribute("fill", marker.color);
    label.textContent = marker.label;
    markerGroup.appendChild(label);
  }

  svg.appendChild(markerGroup);

  // Extend viewBox downward if the label would be clipped above the chart.
  if (vb && vb.length === 4) {
    const neededTop = Math.min(0, chartTopY - 24);
    if (neededTop < vb[1]) {
      const delta = vb[1] - neededTop;
      vb[1] = neededTop;
      vb[3] += delta;
      svg.setAttribute("viewBox", vb.join(" "));
      svg.setAttribute("height", String(vb[3]));
    }
  }
}

const GANTT_MARKERS: GanttMarker[] = [
  { date: "2026-07-14", label: "Phase 2 (12 weeks)" },
  { date: "2026-08-15", label: "Surgery" },
];

function flowchartTheme(scheme: Scheme) {
  return scheme === "dark"
    ? {
        fontSize: "13.5px",
        fontFamily: FONT_STACK,
        primaryColor: "#1e293b",
        primaryTextColor: "#e2e8f0",
        primaryBorderColor: "#334155",
        lineColor: "#64748b",
        edgeLabelBackground: "#0f172a",
        tertiaryColor: "#0f172a",
        tertiaryBorderColor: "#334155",
        tertiaryTextColor: "#cbd5e1",
      }
    : {
        fontSize: "13.5px",
        fontFamily: FONT_STACK,
        primaryColor: "#f0f4ff",
        primaryTextColor: "#1a1a2e",
        primaryBorderColor: "#c7d2fe",
        lineColor: "#9ca3af",
        edgeLabelBackground: "#ffffff",
        tertiaryColor: "#f8fafc",
        tertiaryBorderColor: "#e2e8f0",
        tertiaryTextColor: "#374151",
      };
}

function ganttTheme(scheme: Scheme) {
  return scheme === "dark"
    ? {
        fontFamily: FONT_STACK,
        fontSize: "13px",
        sectionBkgColor: "rgba(148, 163, 184, 0.05)",
        altSectionBkgColor: "rgba(148, 163, 184, 0.01)",
        sectionBkgColor2: "rgba(148, 163, 184, 0.05)",
        titleColor: "#f1f5f9",
        taskTextColor: "#f1f5f9",
        taskTextLightColor: "#f1f5f9",
        taskTextOutsideColor: "#cbd5e1",
        taskTextDarkColor: "#0f172a",
        taskBorderColor: "#475569",
        taskBkgColor: "#334155",
        activeTaskBkgColor: "#4338ca",
        activeTaskBorderColor: "#818cf8",
        doneTaskBkgColor: "#166534",
        doneTaskBorderColor: "#22c55e",
        critBkgColor: "#991b1b",
        critBorderColor: "#f87171",
        gridColor: "rgba(148, 163, 184, 0.14)",
        todayLineColor: "#f97316",
      }
    : {
        fontFamily: FONT_STACK,
        fontSize: "13px",
        sectionBkgColor: "#f8fafc",
        altSectionBkgColor: "#ffffff",
        sectionBkgColor2: "#f8fafc",
        titleColor: "#0f172a",
        taskTextColor: "#1f2937",
        taskTextLightColor: "#1f2937",
        taskTextOutsideColor: "#475569",
        taskTextDarkColor: "#ffffff",
        taskBorderColor: "#cbd5e1",
        taskBkgColor: "#e0e7ff",
        activeTaskBkgColor: "#a5b4fc",
        activeTaskBorderColor: "#4f46e5",
        doneTaskBkgColor: "#bbf7d0",
        doneTaskBorderColor: "#16a34a",
        critBkgColor: "#fecaca",
        critBorderColor: "#dc2626",
        gridColor: "rgba(148, 163, 184, 0.25)",
        todayLineColor: "#ea580c",
      };
}

function isGantt(src: string): boolean {
  return /^\s*gantt\b/m.test(src);
}

export function MermaidRenderer() {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prose = sentinelRef.current?.parentElement;
    if (!prose) return;

    const placeholders = prose.querySelectorAll<HTMLDivElement>(".mermaid-placeholder, .mermaid-diagram");
    if (placeholders.length === 0) return;

    // Stash the original source on each host element the first time we see it,
    // so we can re-render on theme change without losing the graph.
    const hosts: HTMLDivElement[] = [];
    for (const el of Array.from(placeholders)) {
      if (el.classList.contains("mermaid-placeholder")) {
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-diagram";
        const encoded = el.getAttribute("data-graph") ?? "";
        wrapper.setAttribute("data-graph", encoded);
        el.replaceWith(wrapper);
        hosts.push(wrapper);
      } else if (el.hasAttribute("data-graph")) {
        hosts.push(el as HTMLDivElement);
      }
    }

    let cancelled = false;

    async function renderAll(scheme: Scheme) {
      const { default: mermaid } = await import("mermaid");
      if (cancelled) return;

      let idx = 0;
      for (const host of hosts) {
        const encoded = host.getAttribute("data-graph");
        if (!encoded) continue;

        let graph: string;
        try {
          graph = normalisePalette(base64ToUtf8(encoded));
        } catch {
          continue;
        }

        const gantt = isGantt(graph);
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          fontFamily: FONT_STACK,
          flowchart: {
            curve: "basis",
            padding: 20,
            htmlLabels: true,
            useMaxWidth: false,
          },
          gantt: {
            fontSize: 13,
            barHeight: 22,
            barGap: 6,
            topPadding: 52,
            leftPadding: 190,
            rightPadding: 60,
            gridLineStartPadding: 36,
            useMaxWidth: false,
          },
          themeVariables: gantt ? ganttTheme(scheme) : flowchartTheme(scheme),
        });

        const id = `mermaid-diagram-${idx++}-${scheme}-${Date.now()}`;
        try {
          const { svg } = await mermaid.render(id, graph);
          if (cancelled) return;
          host.innerHTML = svg;
          host.setAttribute("data-kind", gantt ? "gantt" : "flow");
          host.setAttribute("data-scheme", scheme);
          if (gantt) {
            // Render at viewBox-native size (not container-scaled), so the
            // type stays readable. Wrapper handles horizontal overflow.
            const rendered = host.querySelector("svg") as SVGSVGElement | null;
            rendered?.removeAttribute("style");
            if (rendered) {
              injectGanttMarkers(rendered, GANTT_MARKERS);
              const vb = rendered.getAttribute("viewBox")?.split(/\s+/);
              if (vb && vb.length === 4) {
                const w = Number(vb[2]);
                const h = Number(vb[3]);
                if (Number.isFinite(w) && Number.isFinite(h)) {
                  rendered.setAttribute("width", String(w));
                  rendered.setAttribute("height", String(h));
                }
              }
            }
          }
        } catch (err) {
          console.warn("Mermaid render error:", err);
          host.innerHTML = "";
          const errDiv = document.createElement("div");
          errDiv.className =
            "mermaid-error text-sm text-red-500 font-mono whitespace-pre-wrap my-4 p-3 border border-red-200 rounded";
          errDiv.textContent = `Mermaid render failed:\n${graph}`;
          host.appendChild(errDiv);
        }
      }
    }

    const scheme = (): Scheme =>
      document.documentElement.classList.contains("dark") ? "dark" : "light";

    renderAll(scheme());

    const observer = new MutationObserver(() => {
      renderAll(scheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}
