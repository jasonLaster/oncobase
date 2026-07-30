import { describe, expect, test } from "bun:test";

import { matchesSeriesIdentifier } from "./series-identifier";

describe("DICOM series deep links", () => {
  const series = {
    id: "convex-row-id",
    seriesKey: "2.25.125273068617921823323029632359324909118",
  };

  test("accepts the catalog row id used by interactive series selection", () => {
    expect(matchesSeriesIdentifier(series, "convex-row-id")).toBe(true);
  });

  test("accepts the stable DICOM series key emitted by share links", () => {
    expect(
      matchesSeriesIdentifier(
        series,
        "2.25.125273068617921823323029632359324909118",
      ),
    ).toBe(true);
  });

  test("rejects a different series", () => {
    expect(matchesSeriesIdentifier(series, "different-series")).toBe(false);
  });
});
