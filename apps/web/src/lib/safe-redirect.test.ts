import { describe, expect, test } from "bun:test";
import { safeLocalRedirect, safeLoginRedirect } from "./safe-redirect";

describe("safeLocalRedirect", () => {
  test("preserves a local path with its query and hash", () => {
    expect(safeLocalRedirect("/wiki/public?view=compact#details")).toBe(
      "/wiki/public?view=compact#details",
    );
  });

  test("rejects absolute and protocol-relative URLs", () => {
    expect(safeLocalRedirect("https://evil.example/phish")).toBe("/");
    expect(safeLocalRedirect("//evil.example/phish")).toBe("/");
    expect(safeLocalRedirect("/\\evil.example/phish")).toBe("/");
  });
});

describe("safeLoginRedirect", () => {
  test("preserves a raw hash only for a valid local target", () => {
    expect(safeLoginRedirect("/about/Terminology", "#brca")).toBe(
      "/about/Terminology#brca",
    );
    expect(safeLoginRedirect("//evil.example/phish", "#brca")).toBe("/");
  });
});
