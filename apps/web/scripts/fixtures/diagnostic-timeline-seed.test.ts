import { describe, expect, test } from "bun:test";

import { diagnosticTimelineSeed } from "./diagnostic-timeline-seed";

describe("diagnostic timeline MRD seed", () => {
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
