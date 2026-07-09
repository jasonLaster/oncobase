import type { SeriesPair } from "./comparisons.ts";

export type ComparisonSide = "left" | "right";

export type MatchState =
  | "exact"
  | "nearest"
  | "manual"
  | "index fallback"
  | "not comparable";

export interface ComparableImage {
  imagePosition: number | null;
}

export interface MatchResult {
  index: number;
  state: MatchState;
  zDelta?: number;
}

export function findMatchedImageIndex(
  pair: SeriesPair,
  sourceSide: ComparisonSide,
  sourceIndex: number,
  sourceImages: ComparableImage[],
  targetImages: ComparableImage[],
): MatchResult {
  if (!targetImages.length) {
    return { index: 0, state: "not comparable" };
  }

  const manual = manualPairMatch(pair, sourceSide, sourceIndex);
  if (manual !== null) {
    return {
      index: clampIndex(manual, targetImages.length),
      state: "manual",
    };
  }

  const sourceImage = sourceImages[sourceIndex];
  if (
    pair.matchingStrategy === "imagePositionPatientZ" &&
    sourceImage?.imagePosition !== null &&
    sourceImage?.imagePosition !== undefined
  ) {
    const nearest = nearestZIndex(sourceImage.imagePosition, targetImages);
    if (nearest) return nearest;
  }

  if (pair.matchingStrategy === "staticPanel") {
    return { index: clampIndex(sourceIndex, targetImages.length), state: "not comparable" };
  }

  return {
    index: normalizedIndex(sourceIndex, sourceImages.length, targetImages.length),
    state: "index fallback",
  };
}

function manualPairMatch(
  pair: SeriesPair,
  sourceSide: ComparisonSide,
  sourceIndex: number,
) {
  for (const manualPair of pair.manualPairs ?? []) {
    if (sourceSide === "left" && manualPair.leftIndex === sourceIndex) {
      return manualPair.rightIndex;
    }
    if (sourceSide === "right" && manualPair.rightIndex === sourceIndex) {
      return manualPair.leftIndex;
    }
  }
  return null;
}

function nearestZIndex(z: number, targetImages: ComparableImage[]): MatchResult | null {
  let bestIndex = -1;
  let bestDelta = Number.POSITIVE_INFINITY;

  targetImages.forEach((image, index) => {
    if (image.imagePosition === null || image.imagePosition === undefined) return;
    const delta = Math.abs(image.imagePosition - z);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });

  if (bestIndex < 0) return null;
  return {
    index: bestIndex,
    state: bestDelta <= 0.05 ? "exact" : "nearest",
    zDelta: bestDelta,
  };
}

function normalizedIndex(sourceIndex: number, sourceLength: number, targetLength: number) {
  if (targetLength <= 1 || sourceLength <= 1) return 0;
  const ratio = clampIndex(sourceIndex, sourceLength) / (sourceLength - 1);
  return clampIndex(Math.round(ratio * (targetLength - 1)), targetLength);
}

function clampIndex(index: number, length: number) {
  return Math.max(0, Math.min(index, Math.max(0, length - 1)));
}
