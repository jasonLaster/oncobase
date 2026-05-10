import { expect, test, type Page } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

const dynamicMasks = (page: Page) => [
  page.locator(".metrics-panel"),
  page.locator(".topbar-status"),
  page.locator(".page-footer"),
];

test.describe("Visual parity", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("desktop reader shell keeps the Diana wiki visual structure", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    await expect(page.locator(".brand-label")).toHaveCSS("color", "rgb(26, 26, 46)");
    await expect(page.locator(".topbar")).toHaveCSS("border-bottom-width", "1px");
    await expect(page.locator(".page-action").first()).toHaveCSS("border-radius", "5px");
    await expect(page.locator(".page-layout")).toHaveScreenshot("desktop-reader-shell.png", {
      animations: "disabled",
      mask: dynamicMasks(page),
      maxDiffPixelRatio: 0.02,
    });
  });

  test("mobile reader shell keeps compact Diana navigation and outline", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    await expect(page.getByTestId("bottom-nav-trigger")).toBeVisible();
    await expect(page.getByTestId("mobile-page-outline")).toBeVisible();
    await expect(page.locator(".page-shell")).toHaveScreenshot("mobile-reader-shell.png", {
      animations: "disabled",
      mask: dynamicMasks(page),
      maxDiffPixelRatio: 0.02,
    });
  });
});
