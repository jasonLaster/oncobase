import { expect } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { documentArticle, installWikiApiMocks, waitForPageTitle } from "./fixtures";
import { assertAdditivePaint, installPaintMonitor } from "./paint-monitor";

const slug = "sources/meeting-notes/09-06---laura-esserman-response-guided-surgery-overview";
const title = "Response-guided surgery overview";

for (const scenario of [
  { name: "desktop defaults", width: 1440, sidebar: 256, pane: "0", paneWidth: 384 },
  { name: "desktop saved widths", width: 1440, sidebar: 192, pane: "1", paneWidth: 300 },
  { name: "mobile", width: 390, sidebar: 256, pane: "0", paneWidth: 384 },
]) {
  test(`${scenario.name}: cold load and cached reload paint additively`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 960 });
    await page.addInitScript((preferences) => {
      localStorage.setItem("sidebar-width", String(preferences.sidebar));
      localStorage.setItem("comments-pane-open", preferences.pane);
      localStorage.setItem("comments-pane-width", String(preferences.paneWidth));
    }, scenario);
    await installPaintMonitor(page);
    const requests = await installWikiApiMocks(page, {
      pageDelays: { [slug]: 600 },
      pageOverrides: {
        [slug]: { title, tags: [], content: `# ${title}\n\nPAINT_BODY_SENTINEL. This fixture exercises a static meeting note.\n\n## Questions\n\nKeep the document visible while its navigation and outline finish loading.` },
      },
    });
    // Delay the manifest on every load: a cached body must survive revalidation.
    await page.route("**/api/wiki/manifest**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fallback();
    });

    for (const phase of ["cold", "cached"]) {
      await test.step(phase, async () => {
        if (phase === "cold") await page.goto(`/${slug}`, { waitUntil: "domcontentloaded" });
        else {
          // A cached reload still waits for React; never display inert controls.
          let release!: () => void;
          const held = new Promise<void>((resolve) => { release = resolve; });
          await page.route("**/*", async (route) => {
            if (route.request().resourceType() === "script") await held;
            await route.fallback();
          });
          try {
            await page.reload({ waitUntil: "commit" });
            await expect(page.locator("#wiki-first-frame-snapshot, #wiki-html-first")).toHaveCount(0);
            await expect(page.locator("#root")).toBeEmpty();
            await page.waitForTimeout(100);
          } finally {
            release();
          }
        }
        await waitForPageTitle(page, title);
        await expect(documentArticle(page)).toContainText("PAINT_BODY_SENTINEL");
        await expect(page.locator("#wiki-first-frame-snapshot").filter({ visible: true })).toHaveCount(0);
        const manifestCount = requests.manifest.length;
        await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
        await expect.poll(() => requests.manifest.length).toBeGreaterThan(manifestCount);
        // Deliberate observation window: final-state assertions miss brief reversals.
        await page.waitForTimeout(1500);
        await assertAdditivePaint(page, testInfo, scenario.width < 768);
        if (phase === "cold") {
          await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("wiki-vite:first-frame:")))).toBe(false);
        }
      });
    }
  });
}

test("live reported route keeps already-painted content during startup", async ({ page }, testInfo) => {
  test.skip(!process.env.ADDITIVE_PAINT_LIVE, "Opt-in authenticated deployed-page probe");
  testInfo.setTimeout(90_000);
  const login = await page.request.post("/api/login", { data: { password: "diana" } });
  expect(login.ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await installPaintMonitor(page);
  for (const phase of ["cold", "cached"]) {
    await test.step(phase, async () => {
      if (phase === "cold") await page.goto(`/${slug}`, { waitUntil: "domcontentloaded" });
      else await page.reload({ waitUntil: "domcontentloaded" });
      await expect(documentArticle(page).locator(".page-header h1")).toContainText(/Esserman/, { timeout: 60_000 });
      await page.waitForTimeout(3000);
      await assertAdditivePaint(page, testInfo);
    });
  }
});

test("paint monitor catches transient CSS hiding and a shrinking rail", async ({ page }) => {
  await installPaintMonitor(page);
  await page.route("**/paint-probe", (route) => route.fulfill({
    contentType: "text/html",
    body: '<aside data-test-id="wiki-sidebar" style="width:256px;height:100px">Navigation</aside><article data-test-id="document-article"><header class="page-header"><h1>Visible title</h1></header><div class="wiki-markdown">Visible body</div></article>',
  }));
  await page.goto("/paint-probe");
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
    const article = document.querySelector<HTMLElement>("article")!;
    article.style.visibility = "hidden";
    document.querySelector<HTMLElement>("aside")!.style.width = "192px";
    await frame();
    await frame();
    article.style.visibility = "visible";
    await frame();
  });
  // A final screenshot would be healthy; the frame history must still fail.
  await expect(page.locator("h1")).toBeVisible();
  const violations = await page.evaluate(() => (window as unknown as {
    paintMonitor: { violations: Array<{ region: string; reason: string }> };
  }).paintMonitor.violations);
  expect(violations).toEqual(expect.arrayContaining([
    expect.objectContaining({ region: "heading", reason: "disappeared after being painted" }),
    expect.objectContaining({ region: "body", reason: "disappeared after being painted" }),
    expect.objectContaining({ region: "navigation", reason: expect.stringContaining("geometry changed") }),
  ]));
});
