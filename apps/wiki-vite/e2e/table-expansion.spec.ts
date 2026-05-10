import { expect, test, type Page } from "@playwright/test";
import {
  documentArticle,
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

  test("keeps the expanded table between the sidebar and outline rails", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const collapsedWidth = await firstSmartTableShell(page)
      .locator("[data-smart-table-wrapper]")
      .first()
      .evaluate((element) => element.getBoundingClientRect().width);

    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();

    const initial = await railMetrics(page);
    expect(initial.layer.left).toBeGreaterThanOrEqual(initial.leftRail.right + 16);
    expect(initial.layer.right).toBeLessThanOrEqual(initial.rightRail.left - 16);
    expect(initial.layer.width).toBeGreaterThan(collapsedWidth);

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect
      .poll(async () => (await railMetrics(page)).layer.width)
      .toBeGreaterThan(initial.layer.width);

    const leftCollapsed = await railMetrics(page);
    expect(leftCollapsed.layer.left).toBeGreaterThanOrEqual(leftCollapsed.leftRail.right + 16);
    expect(leftCollapsed.layer.right).toBeLessThanOrEqual(leftCollapsed.rightRail.left - 16);

    await page.getByRole("button", { name: "Open outline" }).click();
    await expect(page.getByTestId("page-outline")).toHaveAttribute(
      "data-outline-state",
      "expanded",
    );
    const rightExpanded = await railMetrics(page);
    expect(rightExpanded.layer.right).toBeLessThanOrEqual(rightExpanded.rightRail.left - 16);
    expect(rightExpanded.layer.width).toBeLessThan(leftCollapsed.layer.width);

    await page.getByRole("button", { name: "Collapse outline pane" }).click();
    await expect
      .poll(async () => (await railMetrics(page)).layer.width)
      .toBeGreaterThan(rightExpanded.layer.width);
  });

  test("preserves table styling when expanded", async ({ page }) => {
    await expect
      .poll(() =>
        firstSmartTableShell(page)
          .locator("table.smart-table th")
          .first()
          .evaluate((cell) => getComputedStyle(cell).textTransform),
      )
      .toBe("uppercase");
    const before = "uppercase";

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

  test("serves the table examples route in the real Vite app", async ({ page }) => {
    await gotoWiki(page, "/table-examples");

    await expect(documentArticle(page).locator(".page-header h1")).toHaveText("Table Examples");
    await expect(firstSmartTableShell(page)).toBeVisible();
    await expect(firstSmartTableToggle(page)).toBeVisible();
  });
});

async function railMetrics(page: Page) {
  return await page.evaluate(() => {
    const isVisible = (element: HTMLElement | null) => {
      if (!element) return false;
      const r = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return r.width > 0 && r.height > 0 && style.display !== "none";
    };
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const r = element.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        width: r.width,
      };
    };

    const leftRail =
      isVisible(document.querySelector<HTMLElement>("[data-sidebar-expanded-rail]"))
        ? "[data-sidebar-expanded-rail]"
        : "[data-sidebar-collapsed-rail]";

    return {
      layer: rect(".table-expansion-layer"),
      leftRail: rect(leftRail),
      rightRail: rect('[data-test-id="page-outline"]'),
    };
  });
}
