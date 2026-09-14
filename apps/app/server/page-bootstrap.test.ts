import { expect, test } from "bun:test";
import { injectPageBootstrap } from "./page-bootstrap";
import { MAX_BOOTSTRAP_BYTES, parsePageBootstrap } from "../src/bootstrap/page-payload";
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
