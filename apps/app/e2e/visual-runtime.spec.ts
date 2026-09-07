import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

test("visual diagnostics are lazy and opt-in on the actual application entry", async ({ page }) => {
  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  expect(await page.evaluate(() => Boolean(window.__WIKI_VISUAL_STABILITY__))).toBe(false);
  await gotoWiki(page, "/wiki/logistics/insurance?paintDebug=1");
  await expect.poll(() => page.evaluate(() => window.__WIKI_VISUAL_STABILITY__?.report().frames ?? 0)).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report().seen)).toContain("body");
});
