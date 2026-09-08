import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

test.describe("app recovery boundary", () => {
  test("recovers from a failed shell chunk: reloads once, then shows a recovery screen", async ({
    page,
  }) => {
    await installWikiApiMocks(page);

    // Persistently fail the lazy LiveStore shell import. The first failure
    // auto-reloads once (vite:preloadError); the reload fails again and, with
    // the current build reload guard spent, surfaces the recovery screen instead of
    // a blank #root.
    await page.route(/LiveStoreRoot/, (route) => route.abort());

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const recovery = page.getByTestId("app-recovery");
    await expect(recovery).toBeVisible({ timeout: 20_000 });
    await expect(recovery).toContainText("The reader needs to reload");
    await expect(page.getByTestId("app-recovery-reload")).toBeVisible();

    const rootHtml = await page.locator("#root").innerHTML();
    expect(rootHtml.length).toBeGreaterThan(0);
  });
});


test("a stale lazy feature reloads even when an earlier deployment used its recovery", async ({ page }) => {
  await installWikiApiMocks(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("skew-fixture-installed")) {
      sessionStorage.setItem("skew-fixture-installed", "1");
      sessionStorage.setItem("wiki-vite:reloaded-for-load-error", "/assets/older-entry.js");
    }
  });
  let failed = false;
  let navigations = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/\/CommandPalette-[^/]+\.js/, route => {
    if (!failed) { failed = true; return route.abort(); }
    return route.continue();
  });
  await page.goto("/", {waitUntil:"domcontentloaded"});
  await page.getByTestId("sidebar-search").click();
  await expect.poll(() => navigations).toBe(2);
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
  expect(failed).toBe(true);
  expect(errors.some(error => /reading ['"]default['"]|reading ['"]CommandPalette['"]/.test(error))).toBe(false);
});
