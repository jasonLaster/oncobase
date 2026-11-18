import { describe, expect, test } from "bun:test";
import { makePublicWikiSessionIdentity } from "@oncobase/wiki-content";
import { injectNavigationBootstrap, injectPageBootstrap, injectSessionPageBootstrap, navigationSlice } from "../../server/page-bootstrap";
import { bootBlocksFromHtml, bootInputs, documentPublicIdentity, documentSessionIdentity } from "./boot-inputs";
import { documentInitialReaderData } from "./initial-reader-data";

// The first frame is a pure function of boot inputs, and the inputs a browser
// reads back from served HTML are the ones the server wrote: what a server
// render needs to produce exactly the client's first frame.
const template = '<html><head></head><body><div id="root"></div></body></html>';
const url = new URL("https://example.test/wiki/page");
const location = { origin: url.origin, pathname: url.pathname, search: "" };
const env = { VITE_WIKI_SITE_SLUG: "example" };
const now = 1_000_000;
const slugs = ["wiki/page", "wiki/other", "sources/a"];
const tree = navigationSlice(slugs, "wiki/page");

describe("a public document", () => {
  const page = { slug: "wiki/page", title: "Page", content: "Hello </script> café", contentHash: "h1", sensitive: false };
  const html = injectNavigationBootstrap(injectPageBootstrap(template, page, url, "example", { publicSessionVerified: true }),
    tree, url, "example", { scope: "public" });

  test("reads back to the same inputs and the same first frame", () => {
    const inputs = bootInputs(location, env, bootBlocksFromHtml(html, now - 5), now);
    expect(inputs.page?.raw).toContain("Hello");
    expect(documentSessionIdentity(inputs)).toBeNull();
    const identity = documentPublicIdentity(inputs, null);
    expect(identity).toEqual(makePublicWikiSessionIdentity("example"));
    const initial = documentInitialReaderData(inputs, identity!);
    expect(initial?.page).toMatchObject({ slug: "wiki/page", title: "Page", content: page.content, contentHash: "h1" });
    expect(initial?.tree.map(node => node.name)).toContain("wiki");
    // Deterministic: the same inputs give the same frame.
    expect(documentInitialReaderData(inputs, identity!)).toEqual(initial);
  });

  test("a stale or explicitly disabled payload presents nothing", () => {
    const stale = bootInputs(location, env, bootBlocksFromHtml(html, now - 60_001), now);
    expect(documentPublicIdentity(stale, null)).toBeNull();
    expect(documentInitialReaderData(stale, makePublicWikiSessionIdentity("example"))).toBeNull();
    const off = bootInputs({ ...location, search: "?readerBootstrap=0" }, env, bootBlocksFromHtml(html, now), now);
    expect(documentInitialReaderData(off, makePublicWikiSessionIdentity("example"))).toBeNull();
  });
});

describe("a signed-in document", () => {
  const identity = { siteSlug: "example", scope: "session" as const, authenticated: true, cacheVersion: "v1",
    cacheKey: "example:session:abc:v1", userHash: "abc" };
  const record = { slug: "wiki/page", title: "Page", content: "Care only", contentHash: "h", sensitive: true, tags: [], size: 9 };
  const html = injectNavigationBootstrap(injectSessionPageBootstrap(template, identity, record, url, "example"),
    tree, url, "example", { scope: "session", identity });

  test("carries the session identity, and its page only for that identity", () => {
    const inputs = bootInputs(location, env, bootBlocksFromHtml(html, now), now);
    expect(documentSessionIdentity(inputs)).toEqual(identity);
    expect(documentInitialReaderData(inputs, identity)?.page.content).toBe("Care only");
    expect(documentInitialReaderData(inputs, { ...identity, cacheKey: "example:session:other:v1", userHash: "other" })).toBeNull();
    expect(documentInitialReaderData(inputs, makePublicWikiSessionIdentity("example"))).toBeNull();
  });

  test("an explicit public scope or another configured site ignores it", () => {
    expect(documentSessionIdentity(bootInputs({ ...location, search: "?scope=public" }, env, bootBlocksFromHtml(html, now), now))).toBeNull();
    expect(documentSessionIdentity(bootInputs(location, { VITE_WIKI_SITE_SLUG: "other" }, bootBlocksFromHtml(html, now), now))).toBeNull();
  });
});
