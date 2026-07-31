import { describe, expect, test } from "bun:test";
import { isStoredAssetSensitive } from "./asset-visibility";

describe("isStoredAssetSensitive", () => {
  test("uses explicit asset visibility for newly published rows", () => {
    expect(
      isStoredAssetSensitive(
        { ownerSlugs: ["private/plan"], sensitive: true },
        { sensitive: false },
      ),
    ).toBe(true);
    expect(
      isStoredAssetSensitive(
        { ownerSlugs: ["wiki/public"], sensitive: false },
        { sensitive: true },
      ),
    ).toBe(true);
    expect(
      isStoredAssetSensitive(
        { ownerSlugs: ["wiki/public"], sensitive: false },
        { sensitive: false },
      ),
    ).toBe(false);
  });

  test("fails closed when legacy visibility metadata is incomplete", () => {
    expect(isStoredAssetSensitive({}, { sensitive: true })).toBe(true);
    expect(isStoredAssetSensitive({}, { sensitive: false })).toBe(true);
    expect(
      isStoredAssetSensitive({ sensitive: false }, { sensitive: false }),
    ).toBe(true);
    expect(
      isStoredAssetSensitive({ ownerSlugs: [] }, { sensitive: false }),
    ).toBe(true);
    expect(isStoredAssetSensitive(undefined, undefined)).toBe(true);
  });
});
