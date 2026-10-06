import { describe, expect, test } from "bun:test";

import { diagnosticTimelineSeed } from "./diagnostic-timeline-seed";

describe("diagnostic timeline MRD seed", () => {
  test("shows later Signatera results by collection date with canonical report links", () => {
    const tracks = diagnosticTimelineSeed.sleeves.find(
      (sleeve) => sleeve.id === "molecular",
    )!.tracks;
    const events = tracks.find((track) => track.id === "signatera")!.events;
    for (const date of ["2026-08-26", "2026-09-21"]) {
      const event = events.find((entry) => entry.id === `signatera-${date}`)!;
      const slug = `${date.slice(5)}-signatera-ctdna`;
      expect(event).toMatchObject({ date, status: "reported", value: 0 });
      expect(event.links).toContainEqual({
        label: "Source page",
        href: `/sources/diagnostics/${slug}/${slug}`,
      });
      expect(diagnosticTimelineSeed.metadata.range.end >= date).toBe(true);
    }
    expect(events.find((event) => event.id === "signatera-2026-09-21")!.result)
      .toContain("before September 24 surgery");
    expect(tracks.find((track) => track.id === "personalis")!.events.at(-1)!.date)
      .toBe("2026-07-20");
  });

  test("includes the four reported July tumor-informed MRD results", () => {
    const molecular = diagnosticTimelineSeed.sleeves.find(
      (sleeve) => sleeve.id === "molecular",
    );
    const signatera = molecular?.tracks.find((track) => track.id === "signatera");
    const personalis = molecular?.tracks.find((track) => track.id === "personalis");

    expect(signatera?.events.map((event) => event.id)).toEqual(
      expect.arrayContaining([
        "signatera-2026-07-01",
        "signatera-2026-07-20",
      ]),
    );
    expect(personalis?.events.map((event) => event.id)).toEqual(
      expect.arrayContaining([
        "personalis-2026-07-06",
        "personalis-2026-07-20",
      ]),
    );
    expect(
      signatera?.events.find((event) => event.id === "signatera-2026-07-01"),
    ).toMatchObject({ status: "reported", value: 0 });
    expect(
      personalis?.events.find((event) => event.id === "personalis-2026-07-06"),
    ).toMatchObject({ status: "reported", valueLabel: "ctDNA not detected" });
    expect(
      signatera?.events.some((event) => event.id === "signatera-late-june-planned"),
    ).toBe(false);
  });
});
