import { expect, test } from "bun:test";
import { createHtmlPageCache } from "./html-page-cache";

test("render work is reused by site, revision and redacted content", () => {
  let renders = 0;
  const cache = createHtmlPageCache(page => { renders++; return page.content; });
  const page = { slug: "index", contentHash: "v1", content: "public" };
  expect(cache("a", page)).toBe("public");
  expect(cache("a", page)).toBe("public");
  expect(renders).toBe(1);
  cache("b", page);
  cache("a", { ...page, contentHash: "v2" });
  expect(cache("a", { ...page, content: "redacted" })).toBe("redacted");
  expect(renders).toBe(4);
});

test("LRU eviction and byte budgets bound memory; oversized pages are never retained", () => {
  let renders = 0;
  const cache = createHtmlPageCache(page => { renders++; return page.content; }, { entries: 2, entryBytes: 8, totalBytes: 10 });
  const get = (slug: string, content = "12345") => cache("a", { slug, content });
  get("a"); get("b"); get("a"); get("c"); // b is oldest, not a.
  get("a"); expect(renders).toBe(3);
  get("b"); expect(renders).toBe(4);
  get("large", "123456789"); get("large", "123456789"); expect(renders).toBe(6);
  get("bytes", "12345678"); get("b"); expect(renders).toBe(8);
});
