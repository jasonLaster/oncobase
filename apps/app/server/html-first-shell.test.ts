import { expect, test } from "bun:test";
import { injectHtmlFirstShell } from "./html-first-shell";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const page = { slug: "wiki/test", title: "Price $& $` $' $$", content: "Literal $& $` $' $$", contentHash: "fixture", sensitive: false };
const template = '<html><head></head><body><div id="root"></div></body></html>';

test("HTML insertion preserves literal dollar replacement sequences in content and bootstrap JSON", () => {
  const html = injectHtmlFirstShell(template, page, new URL("https://example.com/wiki/test"), "test", "", "<p>Literal $&amp; $` $' $$</p>");
  expect(html).toContain("<p>Literal $&amp; $` $' $$</p>");
  expect(JSON.parse(html.match(/id="wiki-page-bootstrap" type="application\/json">([^<]*)</)![1]!).page.content).toBe(page.content);
});

test("minified server output produces syntactically valid inline startup scripts", async () => {
  const result = await Bun.build({ entrypoints: [new URL("./html-first-shell.ts", import.meta.url).pathname],
    target: "node", format: "esm", minify: true });
  expect(result.success).toBe(true);
  const source = await result.outputs[0]!.text();
  const dir = await mkdtemp(join(tmpdir(), "reader-bundle-test-"));
  try {
    const path = join(dir, "reader.mjs");
    await writeFile(path, source);
    const bundled = await import(pathToFileURL(path).href);
    const html = bundled.injectHtmlFirstShell(template, page, new URL("https://example.com/wiki/test"), "test", "", "<p>Readable.</p>") as string;
    for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!match[1]!.includes("application/json")) expect(() => new Function(match[2])).not.toThrow();
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("large articles keep their complete readable HTML without duplicating Markdown in the startup payload", () => {
  const large = { ...page, content: "Already present in the HTML.\n\n".repeat(10_000) };
  const body = "<p>First paragraph.</p>" + "<p>Complete middle content.</p>".repeat(10_000) + "<p>Last paragraph.</p>";
  const html = injectHtmlFirstShell(template, large, new URL("https://example.com/wiki/test"), "test", "", body);
  expect(html).toContain(body);
  expect(html).not.toContain('id="wiki-page-bootstrap"');
  expect(html).not.toContain(large.content);
  expect(html).toContain("Open interactive reader");
});
