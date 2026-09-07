import { expect, test } from "bun:test";
import { injectHtmlFirstPage, renderHtmlFirstBody, renderReadableHtmlFirstParts } from "./html-first-experiment";

const page = { slug: "index", title: "Example", contentHash: "revision-1", sensitive: false, content: "Readable without JavaScript.\n\n[Next](/wiki/next)\n\n## Section\n\n[Jump](#section)" };

test("server HTML preserves native links while removing executable markup and fake controls", () => {
  const html = renderHtmlFirstBody({ ...page, content: page.content + '\n\n<script>alert(1)</script><img src="x" onerror="alert(1)"><iframe srcdoc="bad"></iframe>\n\n[unsafe](javascript:alert)\n\n[encoded](/api/file?path=%3Cimg%20src=x%20onerror=alert(1)%3E.pdf)' }, "test");
  expect(html).toContain('href="/wiki/next"');
  expect(html).toContain('href="#wiki-html-section"');
  expect(html).toContain('id="wiki-html-section"');
  expect(html).not.toMatch(/<script|<iframe|onerror="|javascript:|role="button"|tabindex="0"/i);
});

test("render cache keys use redacted bytes rather than only the source revision", () => {
  expect(renderHtmlFirstBody(page, "test")).toContain("Readable");
  expect(renderHtmlFirstBody({ ...page, content: "Redacted replacement." }, "test")).toContain("Redacted replacement.");
  expect(renderHtmlFirstBody({ ...page, content: "Another site." }, "other")).not.toContain("Readable");
});

test("only explicitly public, versioned pages can be injected, and attribute data is escaped", () => {
  const template = '<html><head></head><body><div id="root"></div></body></html>';
  const url = new URL("https://example.com/");
  for (const sensitive of [true, undefined]) {
    expect(injectHtmlFirstPage(template, { ...page, sensitive }, url, "test")).toBe(template);
  }
  expect(injectHtmlFirstPage(template, { ...page, contentHash: null }, url, "test")).toBe(template);
  const html = injectHtmlFirstPage(template, { ...page, contentHash: '\"><script>alert(1)</script>' }, url, "test");
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain("&lt;script&gt;");
});


test("initial article images defer offscreen requests and decoding", () => {
  const html = renderHtmlFirstBody({ slug: "wiki/test", title: "Test", content: "Opening text.\n\n![Figure](./figure.png)", sensitive: false, contentHash: "lazy-image-fixture" }, "diana");
  expect(html).toContain('loading="lazy"'); expect(html).toContain('decoding="async"');
  expect(html).toContain("/api/file?path=wiki%2Ffigure.png");
});


test("long readable HTML preserves every block inside a no-script remainder", () => {
  const page = { slug: "wiki/long", title: "Long", content: "Opening paragraph.\n\n" + ("A complete later paragraph. " + "Readable content. ".repeat(16) + "\n\n").repeat(600) + "Final paragraph.", sensitive: false, contentHash: "long-reading" };
  const parts = renderReadableHtmlFirstParts(page);
  expect(parts.first).toContain("Opening paragraph.");
  expect(parts.first).not.toContain("Final paragraph.");
  expect(parts.rest()).toContain('<noscript id="wiki-html-first-rest">');
  expect(parts.rest()).toContain("Final paragraph.");
  expect(parts.rest().match(/A complete later paragraph/g)!.length + parts.first.match(/A complete later paragraph/g)!.length).toBe(600);
});
