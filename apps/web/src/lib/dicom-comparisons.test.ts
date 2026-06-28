import { describe, expect, test } from "bun:test";

import { aprilJuneMriSeriesSummary } from "../../scripts/fixtures/diagnostic-comparisons-seed";
import {
  normalizeDiagnosticComparisonsPayload,
  seriesPairsFromSeriesSummary,
} from "./dicom-comparisons";

const leftStudyId = "diagnostic-2026-04-01-breast-mri";
const rightStudyId = "diagnostic-2026-06-26-breast-mri";

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
});
