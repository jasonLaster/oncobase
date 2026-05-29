"use client";

import {
  WikiMermaidRenderer,
  type WikiMermaidGanttMarker,
} from "@diana-tnbc/wiki-markdown/mermaid";

const DIANA_GANTT_MARKERS: WikiMermaidGanttMarker[] = [
  { date: "2026-07-14", label: "Phase 2 (12 weeks)" },
  { date: "2026-09-10", label: "Surgery" },
];

const DIANA_GANTT_REFERENCE_YEAR = 2026;

export function MermaidRenderer() {
  return (
    <WikiMermaidRenderer
      ganttAxisReferenceYear={DIANA_GANTT_REFERENCE_YEAR}
      ganttMarkers={DIANA_GANTT_MARKERS}
    />
  );
}
