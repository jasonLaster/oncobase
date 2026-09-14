import { expect, test } from "bun:test";
import { WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { initialReaderData } from "./initial-reader-data";

const request = { origin: "https://example.test", apiOrigin: "https://example.test", pathname: "/", siteSlug: "test" };
const payload = { ...request, version: 1, readerVersion: WIKI_READER_CACHE_VERSION, scope: "public",
  page: { slug: "index", title: "Home", content: "CURRENT_REDACTION", sensitive: false, tags: [], size: 17, contentHash: "hash" } };
const raw = JSON.stringify(payload);

test("initial presentation accepts only fresh, matching public response data", () => {
  expect(initialReaderData(raw, 1000, request, null, 1001)?.page.content).toBe("CURRENT_REDACTION");
  for (const receivedAt of [NaN, Infinity, -60_000, 1002]) {
    expect(initialReaderData(raw, receivedAt, request, null, 1001)).toBeNull();
  }
  for (const patch of [{ origin: "https://other.test" }, { apiOrigin: "https://other.test" }, { siteSlug: "other" }, { pathname: "/wiki/other" }]) {
    expect(initialReaderData(raw, 1000, { ...request, ...patch }, null, 1001)).toBeNull();
  }
  for (const patch of [{ scope: "session" }, { readerVersion: "old" }, { page: { ...payload.page, sensitive: true } }, { page: { ...payload.page, slug: "other" } }]) {
    expect(initialReaderData(JSON.stringify({ ...payload, ...patch }), 1000, request, null, 1001)).toBeNull();
  }
  expect(initialReaderData(raw, 1000, request, "invalid navigation", 1001)?.tree).toEqual([]);
});
