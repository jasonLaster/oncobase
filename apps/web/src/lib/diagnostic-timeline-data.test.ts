import { describe, expect, it } from "bun:test";

import {
  countDiagnosticTimelineEvents,
  prepareDiagnosticTimeline,
  type DiagnosticTimelineData,
} from "@/lib/diagnostic-timeline-data";

const sampleTimeline: DiagnosticTimelineData = {
  metadata: {
    title: "Diagnostic Timeline",
    asOf: "2026-06-01",
    range: {
      start: "2026-02-01",
      end: "2026-07-15",
    },
    sourcePages: [{ label: "Diagnostics", href: "/diagnostics" }],
  },
  sleeves: [
    {
      id: "imaging",
      label: "Imaging",
      description: "Imaging tests",
      tone: "#9a6b52",
      tracks: [
        {
          id: "mri",
          label: "MRI",
          kind: "events",
          color: "#9a6b52",
          events: [
            {
              id: "mri-2026-04-01",
              date: "2026-04-01",
              label: "Breast MRI",
              result: "Known diagnostic MRI.",
              status: "reported",
              diagnosticId: "diagnostic-2026-04-01-breast-mri",
            },
          ],
        },
      ],
    },
  ],
};

describe("diagnostic timeline data", () => {
  it("prepares Convex timeline data with the default visible window", () => {
    const timeline = prepareDiagnosticTimeline(sampleTimeline, "2026-06-24");

    expect(timeline.metadata.asOf).toBe("2026-06-24");
    expect(timeline.metadata.defaultRange).toEqual({
      start: "2026-04-02",
      end: "2026-06-24",
    });
    expect(timeline.metadata.range.start).toBe("2026-02-01");
    expect(timeline.metadata.range.end).toBe("2026-07-15");
    expect(countDiagnosticTimelineEvents(timeline)).toBe(1);
  });

  it("enriches diagnostic events with report and viewer links", () => {
    const timeline = prepareDiagnosticTimeline(sampleTimeline, "2026-06-24");
    const mri = timeline.sleeves
      .flatMap((sleeve) => sleeve.tracks)
      .flatMap((track) => track.events)
      .find((event) => event.id === "mri-2026-04-01");

    expect(mri?.links?.map((link) => link.href)).toEqual(
      expect.arrayContaining([
        "/diagnostics/imaging",
        "/tools/dicom-viewer?id=diagnostic-2026-04-01-breast-mri",
      ]),
    );
    expect(mri?.links?.some((link) => link.label === "MRI report")).toBe(true);
  });
});
