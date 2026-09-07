import { afterEach, expect, test } from "bun:test";
import { makeInMemoryAdapter } from "@livestore/adapter-web";
import { createStorePromise } from "@livestore/livestore";
import { makePublicWikiSessionIdentity, WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { schema } from "../livestore/schema";
import { pageContentBySlug$, pageIndex$, siteState$ } from "../livestore/queries";
import { pageToEvent } from "../wiki-utils";
import { seedPagePayload } from "./seed-page";
import { hasBootstrappedPage } from "./seed-state";

const identity = makePublicWikiSessionIdentity("test");
const request = { origin: "https://example.com", apiOrigin: "https://example.com", pathname: "/" };
const page = { slug: "index", title: "Home", content: "REDACTED_NEW_BODY", tags: [], contentHash: "same-source-hash", sensitive: false, size: 17 };
const raw = JSON.stringify({ version: 1, readerVersion: WIKI_READER_CACHE_VERSION, ...request, siteSlug: "test", scope: "public", page });
const stores: Array<{ shutdown: () => Promise<void> }> = [];
async function makeStore(boot?: (store: Parameters<typeof seedPagePayload>[0]) => void) {
  const store = await createStorePromise({ schema, adapter: makeInMemoryAdapter(), disableDevtools: true, storeId: crypto.randomUUID(), boot });
  stores.push(store); return store;
}
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.shutdown())); });

test("provider boot installs a public body before readers mount, without inventing a manifest", async () => {
  const store = await makeStore(store => { seedPagePayload(store, raw, identity, request); });
  expect(store.query(pageContentBySlug$("index"))?.content).toBe(page.content);
  expect(store.query(siteState$)).toBeNull();
  expect(store.query(pageIndex$)).toEqual([]);
  expect(hasBootstrappedPage(store, "index")).toBe(true);
  expect(hasBootstrappedPage(store, "other")).toBe(false);
});

test("replaces stale redactions even at the same source hash, once per store", async () => {
  const store = await makeStore();
  store.commit(pageToEvent({ ...page, content: "OLD_REDACTION" }));
  expect(seedPagePayload(store, raw, identity, request)).toBe(true);
  expect(store.query(pageContentBySlug$("index"))?.content).toBe(page.content);
  store.commit(pageToEvent({ ...page, content: "LATEST_FROM_API", contentHash: "newer" }));
  expect(seedPagePayload(store, raw, identity, request)).toBe(false);
  expect(store.query(pageContentBySlug$("index"))?.content).toBe("LATEST_FROM_API");
  const retry = await makeStore();
  expect(seedPagePayload(retry, raw, identity, request)).toBe(true);
});

test("wrong site and route cannot seed or exempt a body fetch", async () => {
  const store = await makeStore();
  expect(seedPagePayload(store, raw, makePublicWikiSessionIdentity("other"), request)).toBe(false);
  const wrongSlug = JSON.stringify({ ...JSON.parse(raw), page: { ...page, slug: "private/other" } });
  expect(seedPagePayload(store, wrongSlug, identity, request)).toBe(false);
  expect(store.query(pageContentBySlug$("index"))).toBeNull();
  expect(hasBootstrappedPage(store, "index")).toBe(false);
});
