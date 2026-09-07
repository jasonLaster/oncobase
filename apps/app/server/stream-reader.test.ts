import { expect, test } from "bun:test";
import { streamReaderGzip } from "./stream-reader";
import { renderHtmlFirstBody, renderHtmlFirstParts } from "./html-first-experiment";

test("gzip exposes the readable prefix before the remaining renderer runs", async () => {
  let release!: () => void, rendered = false;
  const reader = streamReaderGzip("<p>Already readable.</p>", () => { rendered = true; return "<p>The full remainder.</p>"; }, run => { release = run; })
    .pipeThrough(new DecompressionStream("gzip")).getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toBe("<p>Already readable.</p>");
  expect(rendered).toBe(false);
  release();
  let rest = "";
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
  expect(rest).toBe("<p>The full remainder.</p>");
});

test("streamed blocks preserve the full article, links, duplicate heading ids and tables", () => {
  const page = { slug: "wiki/test", title: "Fixture", contentHash: "fixture", content:
    "Opening paragraph with [reference][ref].\n\n## Repeat\n\n" + "A paragraph.\n\n".repeat(400) +
    "## Repeat\n\n| A | B |\n|---|---|\n| One | Two |\n\n[ref]: https://example.com\n" };
  const parts = renderHtmlFirstParts(page);
  expect(parts.first.length).toBeLessThan(renderHtmlFirstBody(page, "fixture").length);
  expect(parts.first + parts.rest()).toBe(renderHtmlFirstBody(page, "fixture"));
  expect(parts.rest()).toContain('id="wiki-html-repeat-1"');
});

test("raw HTML keeps its complete sanitizer context and never exposes executable markup", () => {
  const page = { slug: "wiki/test", title: "Fixture", contentHash: "fixture-html", content:
    '<div>\n\nOpening.\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n</div>' };
  const parts = renderHtmlFirstParts(page);
  expect(parts.first + parts.rest()).toBe(renderHtmlFirstBody(page, "fixture"));
  expect(parts.first).not.toMatch(/<script|onerror=/);
});
