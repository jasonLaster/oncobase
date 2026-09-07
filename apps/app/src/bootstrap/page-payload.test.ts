import { expect, test } from "bun:test";
import { WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { MAX_BOOTSTRAP_BYTES, parsePageBootstrap, serializePageBootstrap, type PageBootstrap } from "./page-payload";

const expected = { origin: "https://example.com", apiOrigin: "https://example.com", pathname: "/", siteSlug: "test" };
const payload: PageBootstrap = { ...expected, version: 1, readerVersion: WIKI_READER_CACHE_VERSION, scope: "public",
  page: { slug: "index", title: "Home", content: "Readable", tags: [], size: 8, sensitive: false, contentHash: "hash" } };

test("accepts only matching public payloads with validated page fields", () => {
  expect(parsePageBootstrap(JSON.stringify(payload), expected)?.page.content).toBe("Readable");
  for (const patch of [{ siteSlug: "other" }, { pathname: "/other" }, { origin: "https://other.test" }, { apiOrigin: "https://other.test" }]) {
    expect(parsePageBootstrap(JSON.stringify(payload), { ...expected, ...patch })).toBeNull();
  }
  for (const patch of [{ version: 2 }, { readerVersion: "older" }, { scope: "session" }]) {
    expect(parsePageBootstrap(JSON.stringify({ ...payload, ...patch }), expected)).toBeNull();
  }
  for (const patch of [{ sensitive: true }, { contentHash: null }, { tags: [1] }, { size: -1 }, { content: null }]) {
    expect(parsePageBootstrap(JSON.stringify({ ...payload, page: { ...payload.page, ...patch } }), expected)).toBeNull();
  }
  expect(parsePageBootstrap("not json", expected)).toBeNull();
  expect(parsePageBootstrap(" ".repeat(MAX_BOOTSTRAP_BYTES + 1), expected)).toBeNull();
});

test("script data cannot break out of its HTML element and round-trips exact text", () => {
  const hostile = { ...payload, page: { ...payload.page, content: '</script><script>alert("x")</script>&\u2028\u2029' } };
  const raw = serializePageBootstrap(hostile);
  expect(raw).not.toMatch(/[<>&\u2028\u2029]/);
  expect(parsePageBootstrap(raw, expected)?.page.content).toBe(hostile.page.content);
});
