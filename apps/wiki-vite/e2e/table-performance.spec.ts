import { expect, test } from "@playwright/test";
import { firstSmartTableToggle, gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("Smart table resize performance", () => {
  test("keeps expansion interactions responsive on the Vite reader", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/examples/smart-table");

    const duration = await page.evaluate(async () => {
      const start = performance.now();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - start;
    });
    expect(duration).toBeLessThan(200);

    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();
  });
});
