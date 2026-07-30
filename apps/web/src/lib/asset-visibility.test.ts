import { describe, expect, test } from "bun:test";
import { isStoredAssetSensitive } from "./asset-visibility";

describe("isStoredAssetSensitive", () => {
  test("uses explicit asset visibility for newly published rows", () => {
    expect(
      isStoredAssetSensitive({ sensitive: true }, { sensitive: false }),
    ).toBe(true);
    expect(
      isStoredAssetSensitive({ sensitive: false }, { sensitive: true }),
    ).toBe(false);
  });

  test("falls back to legacy sibling-document visibility", () => {
    expect(isStoredAssetSensitive({}, { sensitive: true })).toBe(true);
    expect(isStoredAssetSensitive({}, { sensitive: false })).toBe(false);
    expect(isStoredAssetSensitive(undefined, undefined)).toBe(false);
  });
});
