import { expect, test } from "@playwright/test";
import { documentArticle, firstSmartTableToggle, gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("Smart table resize performance", () => {
  test("sizes an offscreen table when the reader scrolls toward it", async ({ page }) => {
    await installWikiApiMocks(page, { pageOverrides: { "wiki/examples/smart-table": {
      content: "Opening text.\n\n" + "A readable paragraph before the table.\n\n".repeat(80) +
        "| First | Second | Third |\n| --- | --- | --- |\n| A complete value | Another complete value | The final complete value |",
    } } });
    await gotoWiki(page, "/wiki/examples/smart-table");
    const table = documentArticle(page).locator("table").first();
    await expect(table).toBeAttached();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await table.getAttribute("data-smart-table-widths")).toBeNull();
    await table.scrollIntoViewIfNeeded();
    await expect(table).toHaveAttribute("data-smart-table-widths", /\d/);
    await expect(table).toBeInViewport();
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();
  });

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
