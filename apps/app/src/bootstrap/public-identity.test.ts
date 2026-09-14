import { expect, test } from "bun:test";
import { WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { publicIdentityFromPageBootstrap } from "./public-identity";

const request = { origin: "https://example.com", apiOrigin: "https://example.com", pathname: "/", scope: "public", now: 100_000 };
const payload = { version: 1, readerVersion: WIKI_READER_CACHE_VERSION, origin: request.origin, pathname: "/", siteSlug: "example", scope: "public",
  page: { slug: "index", title: "Home", content: "Public content", contentHash: "hash", tags: [], sensitive: false, size: 14 } };
const raw = JSON.stringify(payload);

test("a fresh response can identify an explicitly public store", () => {
  expect(publicIdentityFromPageBootstrap(raw, 99_000, request)).toMatchObject({ siteSlug: "example", scope: "public", authenticated: false, userHash: null });
});

test("bootstrap data never chooses account scope or infers a signed-out session", () => {
  for (const scope of [null, "session", "auto"]) expect(publicIdentityFromPageBootstrap(raw, 99_000, { ...request, scope })).toBeNull();
});

test("rejects stale, future, malformed, cross-origin, wrong-route and wrong-site payloads", () => {
  for (const stamp of [NaN, 0, 100_001]) expect(publicIdentityFromPageBootstrap(raw, stamp, request)).toBeNull();
  expect(publicIdentityFromPageBootstrap("bad JSON", 99_000, request)).toBeNull();
  for (const patch of [{ apiOrigin: "https://other.com" }, { origin: "https://other.com" }, { pathname: "/other" }, { configuredSiteSlug: "other" }]) {
    expect(publicIdentityFromPageBootstrap(raw, 99_000, { ...request, ...patch })).toBeNull();
  }
  for (const patch of [{ readerVersion: "old" }, { siteSlug: "" }, { scope: "session" }, { page: { ...payload.page, sensitive: true } }]) {
    expect(publicIdentityFromPageBootstrap(JSON.stringify({ ...payload, ...patch }), 99_000, request)).toBeNull();
  }
});


test("automatic scope requires explicit verification from the response; session-only never uses it", () => {
  const verified = JSON.stringify({ ...payload, publicSessionVerified: true });
  expect(publicIdentityFromPageBootstrap(verified, 99_000, { ...request, scope: null })).toMatchObject({ scope: "public", authenticated: false });
  expect(publicIdentityFromPageBootstrap(verified, 99_000, { ...request, scope: "session" })).toBeNull();
  expect(publicIdentityFromPageBootstrap(raw, 99_000, { ...request, scope: null })).toBeNull();
});
