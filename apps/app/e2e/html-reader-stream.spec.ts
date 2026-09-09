import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { injectHtmlFirstPage, renderHtmlFirstParts } from "../server/html-first-experiment";
import { injectHtmlFirstShell } from "../server/html-first-shell";
import { streamReaderGzip } from "../server/stream-reader";
import { sendWebResponse } from "../server/http-adapter";

for (const width of [393, 1280]) {
test(`the browser reads a gzip HTML prefix while the complete remainder is still held at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const css = await readFile(new URL("../.vercel-functions/reader-critical.css", import.meta.url), "utf8");
  const fixture = { slug: "index", title: "Streaming fixture", sensitive: false, contentHash: "stream-fixture",
    content: "Already readable before the remainder exists.\n\n" + "An ordinary paragraph.\n\n".repeat(600) + "The complete final paragraph." };
  let release: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    if (req.url !== "/") { res.writeHead(404).end(); return; }
    const url = new URL("http://" + req.headers.host + "/");
    const marker = "<!--stream-body-->";
    const frame = injectHtmlFirstShell('<html><head></head><body><div id="root"></div></body></html>', fixture, url, "fixture", css, marker, '<a href="/wiki/care">Care folder</a>');
    const [before, after] = frame.split(marker);
    const parts = renderHtmlFirstParts(fixture);
    await sendWebResponse(res, new Response(streamReaderGzip(before + parts.first, () => parts.rest() + after,
      run => { release = run; }), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip", "Cache-Control": "no-store" } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "commit" });
    await expect(page.locator("#wiki-html-first article p").first()).toHaveText("Already readable before the remainder exists.");
    await expect(page.locator("#wiki-html-first article p").first()).toBeVisible();
    if (width < 768) {
      await expect(page.locator(".html-first-files")).not.toHaveAttribute("open");
      await page.locator(".html-first-files > summary").click();
    }
    await expect(page.locator(".html-first-tree").getByRole("link", {name:"Care folder"})).toBeVisible();
    await expect(page.getByText("The complete final paragraph.", { exact: true })).toHaveCount(0);
    expect(await page.locator("#wiki-html-first article p").first().evaluate(node => parseFloat(getComputedStyle(node).lineHeight))).toBeCloseTo(27.2, 2);
    const finish = release!; release = undefined; finish();
    await expect(page.getByText("The complete final paragraph.", { exact: true })).toBeAttached();
    await expect(page.locator("#wiki-html-first article p")).toHaveCount(602);
    // Finishing the streamed response must preserve a menu the reader opened.
    if (width < 768) await expect(page.locator(".html-first-files")).toHaveAttribute("open", "");
  } finally { release?.(); server.closeAllConnections(); server.close(); }
});
}


test("long articles paint their opening first and retain complete text and late fragments with or without JavaScript", async ({ browser }) => {
  const css = await readFile(new URL("../.vercel-functions/reader-critical.css", import.meta.url), "utf8");
  const fixture = { slug: "index", title: "Long fixture", sensitive: false, contentHash: "long-fixture",
    content: "The opening remains readable.\n\n<div>Raw HTML block.</div>\n\n" + ("A later paragraph. " + "Full article content. ".repeat(16) + "\n\n").repeat(600) + "## Last section\n\nThe final paragraph includes `& <literal>` safely." };
  const server = createServer((req, res) => {
    if (req.url !== "/") { res.writeHead(404).end(); return; }
    const url = new URL("http://" + req.headers.host + "/");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(injectHtmlFirstPage('<html><head></head><body><div id="root"></div></body></html>', fixture, url, "fixture", css));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      try {
        const page = await context.newPage();
        const errors: string[] = []; page.on("pageerror", error => errors.push(error.name));
        if (javaScriptEnabled) await page.addInitScript(() => {
          const check = () => {
            const first = document.querySelector<HTMLElement>("#wiki-html-first article p");
            if (!first) { requestAnimationFrame(check); return; }
            requestAnimationFrame(() => requestAnimationFrame(() => {
              Object.assign(window, { openingBeforeExpansion: first.checkVisibility({ checkVisibilityCSS: true }) && !!document.getElementById("wiki-html-first-rest") });
            }));
          };
          requestAnimationFrame(check);
        });
        await page.goto(url);
        await expect(page.locator("#wiki-html-first article p")).toHaveCount(602);
        await expect(page.locator("#wiki-html-first article p").last()).toHaveText("The final paragraph includes & <literal> safely.");
        if (javaScriptEnabled) {
          expect(await page.evaluate(() => (window as any).openingBeforeExpansion)).toBe(true);
          await expect(page.locator("#wiki-html-first-rest")).toHaveCount(0);
          await page.goto(url + "#last-section");
          await page.reload();
          await expect(page.locator("#wiki-html-first-rest")).toHaveCount(0);
          await expect(page.locator("#wiki-html-last-section")).toBeInViewport();
        } else {
          await page.locator("#wiki-html-first article p").last().scrollIntoViewIfNeeded();
          await expect(page.locator("#wiki-html-first article p").last()).toBeInViewport();
        }
        expect(errors).toEqual([]);
      } finally { await context.close(); }
    }
  } finally { server.closeAllConnections(); server.close(); }
});
