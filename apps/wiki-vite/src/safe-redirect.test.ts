import { describe, expect, test } from "bun:test";
import { safeLocalRedirect } from "./safe-redirect";

describe("safeLocalRedirect", () => {
  test("preserves a local path with its query and hash", () => {
    expect(safeLocalRedirect("/wiki/public?scope=session#details")).toBe(
      "/wiki/public?scope=session#details",
    );
  });

  test("rejects an absolute URL", () => {
    expect(safeLocalRedirect("https://evil.example/phish")).toBe("/");
  });

  test("rejects a protocol-relative URL", () => {
    expect(safeLocalRedirect("//evil.example/phish")).toBe("/");
  });

  test("rejects a backslash URL that normalizes cross-origin", () => {
    expect(safeLocalRedirect("/\\evil.example/phish")).toBe("/");
  });
});
