import { describe, expect, test } from "bun:test";
import { internalReaderNotFound, isInternalReaderPath } from "./reader-cache-context";

describe("isInternalReaderPath", () => {
  test("matches the retired namespace regardless of case or encoding", () => {
    for (const pathname of ["/__reader/", "/__reader/html/x", "/__READER/x", "/%5f%5freader/x", "/__reader%2Fx"]) {
      expect(isInternalReaderPath(pathname)).toBe(true);
    }
  });

  test("treats malformed encodings as internal so they fail closed", () => {
    expect(isInternalReaderPath("/%E0%A4%A")).toBe(true);
  });

  test("leaves ordinary routes alone", () => {
    for (const pathname of ["/", "/__readers", "/wiki/__reader/x", "/api/wiki/session"]) {
      expect(isInternalReaderPath(pathname)).toBe(false);
    }
  });

  test("not-found response is private and uncached", () => {
    const response = internalReaderNotFound();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
