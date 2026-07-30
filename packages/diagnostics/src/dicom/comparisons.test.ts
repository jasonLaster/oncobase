import { describe, expect, test } from "bun:test";

import { aprilJuneMriSeriesSummary } from "./fixtures/diagnostic-comparisons-seed.ts";
import {
  normalizeDiagnosticComparisonsPayload,
  seriesPairsFromSeriesSummary,
} from "./comparisons.ts";

const leftStudyId = "diagnostic-2026-04-01-breast-mri";
const rightStudyId = "diagnostic-2026-06-26-breast-mri";
const juneJulySeriesSummary = {
  "0626_sub_phase2": aprilJuneMriSeriesSummary["0626_sub_phase2"],
  "0717_sub_phase2": {
    ...aprilJuneMriSeriesSummary["0626_sub_phase2"],
    root: "0717",
    series_number: "100",
    description: "SUB PH 2",
    count: 260,
  },
  "0626_rt_sub": aprilJuneMriSeriesSummary["0626_rt_sub"],
  "0717_rt_sub": {
    ...aprilJuneMriSeriesSummary["0626_rt_sub"],
    root: "0717",
    series_number: "101",
    description: "RT  SUB",
  },
  "0626_t2": aprilJuneMriSeriesSummary["0626_t2"],
  "0717_t2": {
    ...aprilJuneMriSeriesSummary["0626_t2"],
    root: "0717",
  },
  "0626_adc": aprilJuneMriSeriesSummary["0626_adc"],
  "0717_adc": {
    ...aprilJuneMriSeriesSummary["0626_adc"],
    root: "0717",
  },
  "0626_dcad_mip": aprilJuneMriSeriesSummary["0626_dcad_mip"],
  "0717_dcad_mip": {
    ...aprilJuneMriSeriesSummary["0626_dcad_mip"],
    root: "0717",
  },
};

describe("DICOM comparison metadata", () => {
  test("normalizes series-summary.json into deterministic series pairs", () => {
    const pairs = seriesPairsFromSeriesSummary(aprilJuneMriSeriesSummary, {
      leftStudyId,
      rightStudyId,
    });

    expect(pairs.map((pair) => pair.id)).toEqual([
      "phase-2-subtraction",
      "z-matched-subtraction",
      "right-subtraction-projection",
      "t2-nodal-context",
      "adc-context",
      "dcad-thin-slab",
    ]);
    expect(pairs[0]).toMatchObject({
      label: "Phase-2 subtraction",
      preset: "Subtraction",
      matchingStrategy: "imagePositionPatientZ",
      defaultSlice: 123,
      leftSelector: {
        studyId: leftStudyId,
        seriesNumber: 100,
        description: "SUB PH 2",
        imageCount: 246,
        pixelSpacing: [0.7031, 0.7031],
        sliceThickness: 1.58,
        zRange: [-98.8889846802, 97.1111907959],
        exampleFile: "04-01-breast-mri-4233-MR.dcm",
      },
      rightSelector: {
        studyId: rightStudyId,
        seriesNumber: 101,
        description: "PHASE 2 SUB",
        imageCount: 254,
      },
    });
    expect(pairs.find((pair) => pair.id === "adc-context")).toMatchObject({
      preset: "ADC",
      leftSelector: { seriesNumber: 450, rows: 256, columns: 256 },
      rightSelector: { seriesNumber: 350, rows: 256, columns: 256 },
    });
  });

  test("normalizes comparison manifests and keeps series pairs intact", () => {
    const pairs = seriesPairsFromSeriesSummary(aprilJuneMriSeriesSummary, {
      leftStudyId,
      rightStudyId,
    });

    const payload = normalizeDiagnosticComparisonsPayload({
      comparisons: [
        {
          id: "mri-comparison-2026-04-01-vs-2026-06-26",
          label: "April 1 vs June 26 breast MRI",
          leftStudyId,
          rightStudyId,
          modality: "MR",
          bodyPart: "Breast",
          createdAt: "2026-06-28T00:00:00.000Z",
          sourceArtifacts: ["series-summary.json"],
          seriesPairs: pairs,
          reportAnchors: [
            {
              label: "June response",
              text: "Marked overall improvement with residual scattered enhancement.",
              side: "right",
            },
          ],
          precomputedPanels: [
            {
              label: "Subtraction panel",
              href: "/api/file?path=diagnostics%2Fpanel.png",
            },
          ],
        },
      ],
    });

    expect(payload.comparisons).toHaveLength(1);
    expect(payload.comparisons[0].seriesPairs).toHaveLength(6);
    expect(payload.comparisons[0].caveat).toContain("not a diagnostic radiology report");
    expect(payload.comparisons[0].reportAnchors[0].side).toBe("right");
  });

  test("supports a later longitudinal pair with configurable series prefixes", () => {
    const pairs = seriesPairsFromSeriesSummary(juneJulySeriesSummary, {
      leftStudyId: "diagnostic-2026-06-26-breast-mri",
      rightStudyId: "diagnostic-2026-07-17-breast-mri",
      leftSeriesPrefix: "0626",
      rightSeriesPrefix: "0717",
    });

    expect(pairs).toHaveLength(6);
    expect(pairs[0]).toMatchObject({
      id: "phase-2-subtraction",
      defaultSlice: 127,
      leftSelector: {
        seriesNumber: 101,
        description: "PHASE 2 SUB",
        imageCount: 254,
      },
      rightSelector: {
        seriesNumber: 100,
        description: "SUB PH 2",
        imageCount: 260,
      },
    });
    expect(pairs.find((pair) => pair.id === "right-subtraction-projection")).toMatchObject({
      leftSelector: { seriesNumber: 102 },
      rightSelector: { seriesNumber: 101 },
    });
  });
});
