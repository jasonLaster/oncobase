import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

test.describe("app recovery boundary", () => {
  test("recovers from a failed shell chunk: reloads once, then shows a recovery screen", async ({
    page,
  }) => {
    await installWikiApiMocks(page);

    // Persistently fail the lazy LiveStore shell import. The first failure
    // auto-reloads once (vite:preloadError); the reload fails again and, with
    // the once-per-session guard spent, surfaces the recovery screen instead of
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
