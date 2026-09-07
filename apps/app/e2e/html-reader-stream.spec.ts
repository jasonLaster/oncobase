import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { renderHtmlFirstParts } from "../server/html-first-experiment";
import { injectHtmlFirstShell } from "../server/html-first-shell";
import { streamReaderGzip } from "../server/stream-reader";
import { sendWebResponse } from "../server/http-adapter";

test("the browser reads a gzip HTML prefix while the complete remainder is still held", async ({ page }) => {
  const css = await readFile(new URL("../.vercel-functions/reader-critical.css", import.meta.url), "utf8");
  const fixture = { slug: "index", title: "Streaming fixture", sensitive: false, contentHash: "stream-fixture",
    content: "Already readable before the remainder exists.\n\n" + "An ordinary paragraph.\n\n".repeat(600) + "The complete final paragraph." };
  let release: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    if (req.url !== "/") { res.writeHead(404).end(); return; }
    const url = new URL("http://" + req.headers.host + "/");
    const marker = "<!--stream-body-->";
    const frame = injectHtmlFirstShell('<html><head></head><body><div id="root"></div></body></html>', fixture, url, "fixture", css, marker);
    const [before, after] = frame.split(marker);
    const parts = renderHtmlFirstParts(fixture);
    await sendWebResponse(res, new Response(streamReaderGzip(before + parts.first, () => parts.rest() + after,
      run => { release = run; }), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip", "Cache-Control": "no-store" } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "commit" });
    await expect(page.locator("#wiki-html-first p").first()).toHaveText("Already readable before the remainder exists.");
    await expect(page.locator("#wiki-html-first p").first()).toBeVisible();
    await expect(page.getByText("The complete final paragraph.", { exact: true })).toHaveCount(0);
    expect(await page.locator("#wiki-html-first p").first().evaluate(node => parseFloat(getComputedStyle(node).lineHeight))).toBeCloseTo(27.2, 2);
    const finish = release!; release = undefined; finish();
    await expect(page.getByText("The complete final paragraph.", { exact: true })).toBeAttached();
    await expect(page.locator("#wiki-html-first p")).toHaveCount(602);
  } finally { release?.(); server.closeAllConnections(); server.close(); }
});
