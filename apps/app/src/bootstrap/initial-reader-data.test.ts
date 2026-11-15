import { expect, test } from "bun:test";
import { makePublicWikiSessionIdentity, WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
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

test("a session page presents, with its navigation slice, only for the identity it was produced for", () => {
  const identity = { siteSlug: "test", scope: "session" as const, authenticated: true, cacheVersion: "v1", cacheKey: "test:session:abc:v1", userHash: "abc" };
  const session = JSON.stringify({ ...request, version: 2, readerVersion: WIKI_READER_CACHE_VERSION, scope: "session", identity,
    page: { ...payload.page, content: "CARE_TEAM_BODY", sensitive: true } });
  const navigation = (scope: string, identityKey?: string) => JSON.stringify({ ...request, version: 1, readerVersion: WIKI_READER_CACHE_VERSION,
    scope, ...(identityKey ? { identityKey } : {}), tree: [["d", "wiki", [["f", "index"]]], ["f", "index"]] });
  const data = initialReaderData(session, 1000, request, navigation("session", identity.cacheKey), 1001, identity);
  expect(data?.page.content).toBe("CARE_TEAM_BODY");
  expect(data?.page.sensitive).toBe(true);
  expect(data?.tree.map(node => node.slug)).toEqual(expect.arrayContaining(["wiki", "index"]));
  // Another account, another access set, or no identity: nothing presents.
  expect(initialReaderData(session, 1000, request, null, 1001, { ...identity, cacheKey: "test:session:other:v1" })).toBeNull();
  expect(initialReaderData(session, 1000, request, null, 1001)).toBeNull();
  expect(initialReaderData(session, 1000, request, null, 1001, makePublicWikiSessionIdentity("test"))).toBeNull();
  // A session slice for another identity is dropped; a public slice serves anyone.
  expect(initialReaderData(session, 1000, request, navigation("session", "test:session:other:v1"), 1001, identity)?.tree).toEqual([]);
  expect(initialReaderData(raw, 1000, request, navigation("public"), 1001, identity)?.tree.length).toBe(2);
  expect(initialReaderData(raw, 1000, request, navigation("session", identity.cacheKey), 1001)?.tree).toEqual([]);
});
