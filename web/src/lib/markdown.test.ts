import { describe, expect, test } from "bun:test";
import { getCanonicalSlug } from "./markdown";

describe("getCanonicalSlug", () => {
  test("returns the on-disk casing for mixed-case wiki routes", () => {
    expect(getCanonicalSlug("ABOUT/jOuRnAl")).toBe("about/Journal");
  });

  test("returns null for missing slugs", () => {
    expect(getCanonicalSlug("about/does-not-exist")).toBeNull();
  });
});
