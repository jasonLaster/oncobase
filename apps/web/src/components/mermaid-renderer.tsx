"use client";

import {
  WikiMermaidRenderer,
  type WikiMermaidGanttMarker,
} from "@oncobase/wiki-markdown/mermaid";

const WIKI_GANTT_MARKERS: WikiMermaidGanttMarker[] = [
  { date: "2026-07-14", label: "Phase 2 (12 weeks)" },
  { date: "2026-09-10", label: "Surgery" },
];

const WIKI_GANTT_REFERENCE_YEAR = 2026;

export function MermaidRenderer() {
  return (
    <WikiMermaidRenderer
      ganttAxisReferenceYear={WIKI_GANTT_REFERENCE_YEAR}
      ganttMarkers={WIKI_GANTT_MARKERS}
    />
  );
}
