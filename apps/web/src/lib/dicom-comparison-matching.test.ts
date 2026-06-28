import { describe, expect, test } from "bun:test";

import type { SeriesPair } from "./dicom-comparisons";
import { findMatchedImageIndex } from "./dicom-comparison-matching";

const basePair: SeriesPair = {
  id: "phase-2-subtraction",
  label: "Phase-2 subtraction",
  preset: "Subtraction",
  leftSelector: { studyId: "left" },
  rightSelector: { studyId: "right" },
  matchingStrategy: "imagePositionPatientZ",
};

describe("DICOM comparison slice matching", () => {
  test("matches exact z positions", () => {
    const result = findMatchedImageIndex(
      basePair,
      "left",
      1,
      [{ imagePosition: -1 }, { imagePosition: 0 }, { imagePosition: 1 }],
      [{ imagePosition: -2 }, { imagePosition: 0 }, { imagePosition: 2 }],
    );

    expect(result).toEqual({ index: 1, state: "exact", zDelta: 0 });
  });

  test("uses nearest z when exact position is unavailable", () => {
    const result = findMatchedImageIndex(
      basePair,
      "left",
      2,
      [{ imagePosition: -5 }, { imagePosition: 2 }, { imagePosition: 9 }],
      [{ imagePosition: -4 }, { imagePosition: 6 }, { imagePosition: 10 }],
    );

    expect(result).toEqual({ index: 2, state: "nearest", zDelta: 1 });
  });

  test("prefers manual slice pairs over z matching", () => {
    const result = findMatchedImageIndex(
      {
        ...basePair,
        manualPairs: [{ leftIndex: 4, rightIndex: 7 }],
      },
      "left",
      4,
      Array.from({ length: 10 }, (_, index) => ({ imagePosition: index })),
      Array.from({ length: 10 }, (_, index) => ({ imagePosition: index })),
    );

    expect(result).toEqual({ index: 7, state: "manual" });
  });

  test("falls back to normalized index without usable geometry", () => {
    const result = findMatchedImageIndex(
      basePair,
      "left",
      4,
      Array.from({ length: 9 }, () => ({ imagePosition: null })),
      Array.from({ length: 5 }, () => ({ imagePosition: null })),
    );

    expect(result).toEqual({ index: 2, state: "index fallback" });
  });
});
