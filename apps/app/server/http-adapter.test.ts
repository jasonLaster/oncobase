import { describe, expect, test } from "bun:test";
import { restoreRewrittenPath } from "./http-adapter";

describe("restoreRewrittenPath", () => {
  test("returns the same request when there is no rewrite", () => {
    const request = new Request("https://example.test/wiki/a?x=1");
    expect(restoreRewrittenPath(request)).toBe(request);
  });

  test("an empty rewrite (the site root) maps to /", () => {
    // vercel.json: "/(.*)" -> "/api/app-shell?__path=$1" yields __path= for "/".
    expect(restoreRewrittenPath(new Request("https://example.test/api/app-shell?__path=")).url)
      .toBe("https://example.test/");
  });

  test("restores API and page paths and keeps other query parameters", () => {
    expect(restoreRewrittenPath(new Request("https://example.test/api?__path=api/wiki/session&scope=public")).url)
      .toBe("https://example.test/api/wiki/session?scope=public");
    expect(restoreRewrittenPath(new Request("https://example.test/api/app-shell?__path=wiki/care/results")).url)
      .toBe("https://example.test/wiki/care/results");
  });

  test("collapses leading slashes so the result stays same-origin", () => {
    expect(restoreRewrittenPath(new Request("https://example.test/api?__path=//evil.test/x")).url)
      .toBe("https://example.test/evil.test/x");
  });

  test("preserves method, headers and body", async () => {
    const restored = restoreRewrittenPath(new Request("https://example.test/api?__path=api/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"password":"x"}',
    }));
    expect(restored.method).toBe("POST");
    expect(restored.headers.get("content-type")).toBe("application/json");
    expect(await restored.json()).toEqual({ password: "x" });
  });
});
