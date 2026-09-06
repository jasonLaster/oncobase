import { describe, expect, test } from "bun:test";
import { hasCompleteAssetVisibility } from "./assetVisibility";

describe("hasCompleteAssetVisibility", () => {
  test("accepts current public and sensitive metadata", () => {
    expect(
      hasCompleteAssetVisibility({ ownerSlugs: [], sensitive: false }),
    ).toBe(true);
    expect(
      hasCompleteAssetVisibility({
        ownerSlugs: ["private/plan"],
        sensitive: true,
      }),
    ).toBe(true);
  });

  test("rejects every partially migrated shape", () => {
    expect(hasCompleteAssetVisibility({})).toBe(false);
    expect(hasCompleteAssetVisibility({ sensitive: false })).toBe(false);
    expect(hasCompleteAssetVisibility({ ownerSlugs: [] })).toBe(false);
  });
});
