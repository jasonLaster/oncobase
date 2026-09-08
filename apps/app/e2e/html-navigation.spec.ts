import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { buildFileTreeFromManifest } from "@oncobase/wiki-content";
import { injectHtmlFirstPage } from "../server/html-first-experiment";
import { renderReaderNavigation } from "../server/reader-navigation";

for (const javaScriptEnabled of [false, true]) test(`file tree folders and links work with JavaScript ${javaScriptEnabled ? "enabled" : "disabled"}`, async ({ browser }) => {
  const css = await readFile(new URL("../.vercel-functions/reader-critical.css", import.meta.url), "utf8");
  const tree = buildFileTreeFromManifest([{slug:"index"}, {slug:"wiki/care/index"}, {slug:"wiki/care/results"}]);
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://" + req.headers.host);
    const slug = url.pathname.slice(1) || "index";
    res.writeHead(200, {"Content-Type":"text/html"});
    res.end(injectHtmlFirstPage('<html><head></head><body><div id="root"></div></body></html>',
      {slug, title:"Fixture", content:"Readable fixture.", contentHash:"fixture", sensitive:false}, url, "fixture", css, renderReaderNavigation(tree, slug)));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const context = await browser.newContext({ javaScriptEnabled });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/`);
    await expect(page.locator('.html-first-tree > details > summary')).toBeVisible();
    if (javaScriptEnabled) await expect(page.locator('.html-first-tree a')).toHaveCount(1);
    await page.locator('[data-folder="wiki"] > summary').click();
    await page.locator('[data-folder="wiki/care"] > summary').click();
    await page.locator('.html-first-tree a[href="/wiki/care/results"]').click();
    await expect(page).toHaveURL(/\/wiki\/care\/results$/);
    await expect(page.locator('.html-first-tree [aria-current="page"]')).toHaveText("results");
    await expect(page.locator('#wiki-html-first article')).toBeVisible();
    await page.setViewportSize({width:390, height:844});
    await expect(page.locator('.html-first-files > summary')).toBeVisible();
    await page.locator('.html-first-files > summary').click();
    await expect(page.locator('#wiki-html-first article')).toBeVisible();
  } finally { await context.close(); server.closeAllConnections(); server.close(); }
});
