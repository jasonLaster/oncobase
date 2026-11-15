import { describe, expect, test } from "bun:test";
import { expandCompactFileTree } from "@oncobase/wiki-content";
import { injectNavigationBootstrap, injectPageBootstrap, injectSessionPageBootstrap, navigationSlice } from "./page-bootstrap";
import { MAX_BOOTSTRAP_BYTES, parsePageBootstrap, parseSessionPageBootstrap } from "../src/bootstrap/page-payload";
const template = '<html><head></head><body><div id="root"></div></body></html>';
const url = new URL("https://example.test/wiki/page");
const page = { slug: "wiki/page", title: "Page", content: "Hello </script><script>alert(1)</script> $& café", contentHash: "revision", sensitive: false };

test("data-only bootstrap round-trips text without rendering or injecting scripts", () => {
  const html = injectPageBootstrap(template, page, url, "example");
  const raw = html.match(/type="application\/json">(.*?)<\/script>/s)![1];
  expect(raw).not.toContain("<");
  expect(parsePageBootstrap(raw, { origin: url.origin, apiOrigin: url.origin, pathname: url.pathname, siteSlug: "example" })?.page.content).toBe(page.content);
  expect(html).toContain('<div id="root"></div>');
  expect(html).not.toContain("<article");
  expect(html).toContain("dataset.receivedAt");
  expect(injectPageBootstrap(html, page, url, "example")).toBe(html);
});

test("restricted, unversioned and oversized data retain the API fallback", () => {
  for (const change of [{ sensitive: true }, { sensitive: undefined }, { contentHash: null },
    { content: "x".repeat(MAX_BOOTSTRAP_BYTES) }, { content: "<".repeat(MAX_BOOTSTRAP_BYTES / 2) }]) {
    expect(injectPageBootstrap(template, { ...page, ...change }, url, "example")).toBe(template);
  }
});

describe("signed-in documents", () => {
  const identity = { siteSlug: "example", scope: "session" as const, authenticated: true, cacheVersion: "v1",
    cacheKey: "example:session:abc:v1", userHash: "abc" };
  const record = { slug: "wiki/page", title: "Page", content: "Care </script> only", contentHash: "h", sensitive: true, tags: [], size: 19 };

  test("the session payload carries the API's identity and page, escaped, once", () => {
    const html = injectSessionPageBootstrap(template, identity, record, url, "example");
    const raw = html.match(/id="wiki-page-bootstrap" type="application\/json">(.*?)<\/script>/s)![1];
    expect(raw).not.toContain("<");
    const expected = { origin: url.origin, apiOrigin: url.origin, pathname: url.pathname };
    expect(parseSessionPageBootstrap(raw, expected)?.identity).toEqual(identity);
    expect(parsePageBootstrap(raw, { ...expected, siteSlug: "example" })).toBeNull();
    expect(injectSessionPageBootstrap(html, identity, record, url, "example")).toBe(html);
  });

  test("only an authenticated session identity for this site is inlined", () => {
    for (const patch of [{ scope: "public" as const }, { authenticated: false }, { userHash: null }, { siteSlug: "other" }]) {
      expect(injectSessionPageBootstrap(template, { ...identity, ...patch }, record, url, "example")).toBe(template);
    }
    expect(injectSessionPageBootstrap(template, identity, { ...record, contentHash: null }, url, "example")).toBe(template);
    expect(injectSessionPageBootstrap(template, identity, { ...record, content: "x".repeat(MAX_BOOTSTRAP_BYTES + 1) }, url, "example")).toBe(template);
  });
});

test("the navigation slice is the top level plus the current page's ancestors", () => {
  const slugs = ["index", "about/index", "wiki/a", "wiki/b", "wiki/deep/c", "wiki/deep/d/e", "sources/x/y", "diagnostics/hidden"];
  const tree = expandCompactFileTree(navigationSlice(slugs, "wiki/deep/c"));
  const names = (nodes: ReturnType<typeof expandCompactFileTree>, prefix = ""): string[] =>
    nodes.flatMap(node => [`${prefix}${node.name}`, ...names(node.children ?? [], `${prefix}${node.name}/`)]);
  expect(names(tree).sort()).toEqual(["about", "index", "sources", "wiki", "wiki/a", "wiki/b", "wiki/deep", "wiki/deep/c", "wiki/deep/d"].sort());
  // A page missing from the listing (an allowed sensitive page) still appears.
  expect(names(expandCompactFileTree(navigationSlice(["index"], "private/plan"))).sort()).toEqual(["index", "private", "private/plan"]);
});

test("navigation is bound to its scope, and a session slice to its identity", () => {
  const tree = navigationSlice(["wiki/page"], "wiki/page");
  const html = injectNavigationBootstrap(template, tree, url, "example", { scope: "session", identity: { siteSlug: "example", scope: "session",
    authenticated: true, cacheVersion: "v1", cacheKey: "example:session:abc:v1", userHash: "abc" } });
  const raw = html.match(/id="wiki-navigation-bootstrap" type="application\/json">(.*?)<\/script>/s)![1];
  expect(JSON.parse(raw)).toMatchObject({ scope: "session", identityKey: "example:session:abc:v1", siteSlug: "example" });
  expect(injectNavigationBootstrap(html, tree, url, "example", { scope: "public" })).toBe(html);
});
