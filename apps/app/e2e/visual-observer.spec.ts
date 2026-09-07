import { expect, test } from "@playwright/test";
import { installVisualStabilityObserver } from "../src/visual-stability";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installVisualStabilityObserver);
  await page.route("**/visual-probe", (route) => route.fulfill({ contentType: "text/html", body: `
    <style>body{margin:0}article{padding:20px}h1{margin:0}.wiki-markdown{padding:8px}aside{height:100px;width:256px}</style>
    <aside data-test-id="wiki-sidebar">Navigation</aside>
    <article data-test-id="document-article"><header class="page-header"><h1>PRIVATE_HEADING</h1></header><div class="wiki-markdown"><p>PRIVATE_BODY</p></div></article>` }));
  await page.goto("/visual-probe");
  await expect.poll(() => page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report().seen)).toContain("body");
});

test("detects ancestor opacity, content clearing, and restoration between final assertions", async ({ page }) => {
  await page.evaluate(async () => {
    const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const article = document.querySelector<HTMLElement>("article")!;
    article.style.opacity = "0";
    await frames();
    article.style.opacity = "1";
    await frames();
    const body = document.querySelector<HTMLElement>(".wiki-markdown")!;
    const saved = body.innerHTML;
    body.innerHTML = "";
    await frames();
    body.innerHTML = saved;
    await frames();
  });
  await expect(page.locator("h1")).toBeVisible();
  const report = await page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report());
  expect(report.counts.disappearance).toBeGreaterThanOrEqual(2);
  expect(report.counts.reappearance).toBeGreaterThanOrEqual(2);
  expect(report.counts["content-cleared"]).toBeGreaterThanOrEqual(1);
  expect(report.firstIncident).not.toBeNull();
});

test("attributes native layout shifts and explicitly reports unsupported CLS", async ({ page, browserName }) => {
  await page.waitForTimeout(150);
  await page.evaluate(() => { document.querySelector<HTMLElement>("h1")!.style.marginTop = "120px"; });
  await page.waitForTimeout(150);
  const report = await page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report());
  expect(report.counts.geometry).toBeGreaterThan(0);
  if (browserName === "chromium") {
    expect(report.cls).toBeGreaterThan(0);
    expect(report.events.some((event) => event.kind === "layout-shift" && event.data?.sources)).toBe(true);
  } else if (!report.capabilities.includes("layout-shift")) expect(report.cls).toBeNull();
});

test("bounded reports retain counters, omit private content, reset, and disconnect", async ({ page }) => {
  await page.route("**/api/wiki/pages**", (route) => route.fulfill({ json: {} }));
  await page.evaluate(async () => {
    await fetch("/api/wiki/pages?slugs=PRIVATE_ROUTE");
    for (let index = 0; index < 400; index++) window.__WIKI_VISUAL_STABILITY__!.mark("test");
  });
  const report = await page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report());
  expect(report.events.length).toBeLessThanOrEqual(250);
  expect(report.droppedEvents).toBeGreaterThan(0);
  expect(report.counts["phase:test"]).toBe(400);
  expect(JSON.stringify(report)).not.toMatch(/PRIVATE_HEADING|PRIVATE_BODY|PRIVATE_ROUTE|visual-probe/);
  await page.evaluate(() => {
    window.__WIKI_VISUAL_STABILITY__!.reset();
    window.__WIKI_VISUAL_STABILITY__!.stop();
  });
  await page.waitForTimeout(100);
  const stopped = await page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report());
  expect(stopped.frames).toBe(0);
  expect(stopped.events).toEqual([]);
});
