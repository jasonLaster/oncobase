import { expect, test } from "@playwright/test";
import {
  firstSmartTableShell,
  firstSmartTableToggle,
  gotoWiki,
  installWikiApiMocks,
} from "./fixtures";

test.describe("Prose table expansion", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/examples/smart-table");
  });

  test("expands and collapses the first prose table", async ({ page }) => {
    const shell = firstSmartTableShell(page);
    const collapsedWidth = await shell
      .locator("[data-smart-table-wrapper]")
      .first()
      .evaluate((element) => element.getBoundingClientRect().width);

    await firstSmartTableToggle(page).click();
    const layer = page.locator(".table-expansion-layer").first();
    await expect(layer).toBeVisible();
    const expandedWidth = await layer.evaluate((element) => element.getBoundingClientRect().width);
    expect(expandedWidth).toBeGreaterThan(collapsedWidth);

    await page.getByRole("button", { name: "Collapse table" }).click();
    await expect(layer).toHaveCount(0);
  });

  test("preserves table styling when expanded", async ({ page }) => {
    const before = await firstSmartTableShell(page)
      .locator("table.smart-table th")
      .first()
      .evaluate((cell) => getComputedStyle(cell).textTransform);

    await firstSmartTableToggle(page).click();
    const after = await page
      .locator(".table-expansion-layer table.smart-table th")
      .first()
      .evaluate((cell) => getComputedStyle(cell).textTransform);

    expect(after).toBe(before);
  });

  test("falls back to the in-flow table when resized to mobile while expanded", async ({ page }) => {
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.locator(".table-expansion-layer")).toHaveCount(0);
    await expect(firstSmartTableShell(page).locator("[data-smart-table-wrapper]")).toBeVisible();
  });
});
