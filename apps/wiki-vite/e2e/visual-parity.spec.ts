import { expect, test, type Page } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

const dynamicMasks = (page: Page) => [
  page.locator(".metrics-panel"),
  page.locator(".topbar-status"),
  page.locator(".page-footer"),
];

const hasLocalSnapshotBaseline = process.platform === "darwin" && !process.env.CI;

test.describe("Visual parity", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("desktop reader shell keeps the Diana wiki visual structure", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    await expect(page.locator(".wiki-shell-header")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-workspace-trigger")).toBeVisible();
    await expect(page.getByTestId("sidebar-search")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy page as markdown" })).toBeVisible();
    await expect(page.locator(".wiki-shell-outline-root")).toBeVisible();
    await expect(page.locator(".sidebar-expanded-rail")).toBeVisible();
    await expect(page.getByTestId("wiki-sidebar")).not.toContainText("File tree");
    await expect(page.getByTestId("document-article")).toBeVisible();

    if (hasLocalSnapshotBaseline) {
      await expect(page.locator(".wiki-shell-outline-root")).toHaveScreenshot("desktop-reader-shell.png", {
        animations: "disabled",
        mask: dynamicMasks(page),
        maxDiffPixelRatio: 0.02,
      });
    }
  });

  test("mobile reader shell keeps compact Diana navigation and outline", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    await expect(page.getByTestId("mobile-page-header")).toBeVisible();
    await expect(page.getByTestId("bottom-nav-trigger")).toBeVisible();
    await expect(page.getByTestId("mobile-page-outline")).toBeVisible();
    await expect(page.locator(".wiki-shell-header")).toHaveCount(0);
    await expect(page.locator(".page-shell")).toBeVisible();

    if (hasLocalSnapshotBaseline) {
      await expect(page.locator(".page-shell")).toHaveScreenshot("mobile-reader-shell.png", {
        animations: "disabled",
        mask: dynamicMasks(page),
        maxDiffPixelRatio: 0.02,
      });
    }
  });
});
