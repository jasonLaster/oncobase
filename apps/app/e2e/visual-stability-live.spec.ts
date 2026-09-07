import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installVisualStabilityObserver } from "../src/visual-stability";

const routes = [
  "/sources/meeting-notes/09-06---laura-esserman-response-guided-surgery-overview",
  "/about/Index",
  "/about/Log",
  "/wiki/diagnostics/diagnosis",
  "/wiki/logistics/insurance",
];

// Read-only live probes are deliberately excluded from synthetic CI. No API
// response bodies, titles or DOM are put into the diagnostic JSON attachment.
for (const route of routes) {
  test(`live paint continuity ${route}`, async ({ page }, testInfo) => {
    test.skip(process.env.VISUAL_LIVE !== "1", "Opt-in live environment probe");
    testInfo.setTimeout(120_000);
    expect((await page.request.post("/api/login", { data: { password: "diana" } })).ok()).toBe(true);
    await page.addInitScript(installVisualStabilityObserver);
    for (const phase of ["cold", "cached"]) {
      await test.step(phase, async () => {
        if (phase === "cold") await page.goto(route, { waitUntil: "domcontentloaded" });
        else await page.reload({ waitUntil: "domcontentloaded" });
        try {
          await expect(page.locator('#root [data-test-id="document-article"] .page-header h1')).toBeVisible({ timeout: 60_000 });
          await expect(page.locator('#root [data-test-id="document-article"] .wiki-markdown')).toBeVisible({ timeout: 60_000 });
          await page.waitForTimeout(2500);
          const report = await page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report());
          expect(report.seen).toEqual(expect.arrayContaining(["heading", "body", "navigation"]));
          expect(report.counts.disappearance ?? 0).toBe(0);
          expect(report.counts.geometry ?? 0).toBe(0);
          if (report.cls !== null) expect(report.cls).toBeLessThanOrEqual(0.01);
        } finally {
          const report = await page.evaluate(() => window.__WIKI_VISUAL_STABILITY__?.report());
          if (report) {
            const path = testInfo.outputPath(`live-visual-${phase}.json`);
            await writeFile(path, JSON.stringify(report, null, 2));
            await testInfo.attach(`live-visual-${phase}`, { path, contentType: "application/json" });
          }
        }
      });
    }
  });
}
