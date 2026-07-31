import { describe, expect, test } from "bun:test";
import { canAccessWithoutProtectedRule } from "./accessPolicy";

describe("access policy defaults", () => {
  test("keeps public documents readable without a protected rule", () => {
    expect(
      canAccessWithoutProtectedRule({
        documentExists: true,
        sensitive: false,
      }),
    ).toBe(true);
  });

  test("fails closed for sensitive and missing documents", () => {
    expect(
      canAccessWithoutProtectedRule({
        documentExists: true,
        sensitive: true,
      }),
    ).toBe(false);
    expect(
      canAccessWithoutProtectedRule({
        documentExists: false,
        sensitive: false,
      }),
    ).toBe(false);
  });
});
