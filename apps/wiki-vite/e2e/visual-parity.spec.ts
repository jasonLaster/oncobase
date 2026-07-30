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
    await expect(page.getByTestId("mobile-page-outline")).toHaveCount(0);
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

  for (const theme of ["light", "dark"] as const) {
    test(`file palette matches production ${theme} surfaces`, async ({ page }) => {
      await page.addInitScript((nextTheme) => {
        localStorage.setItem("theme", nextTheme);
      }, theme);
      await gotoWiki(page, "/");
      await page.getByTestId("sidebar-search").click();

      const palette = page.getByTestId("command-palette");
      await expect(palette).toBeVisible();
      await expect(palette.getByRole("option").first()).toHaveCSS(
        "box-shadow",
        "none",
      );

      if (hasLocalSnapshotBaseline) {
        await expect(palette).toHaveScreenshot(`file-palette-${theme}.png`, {
          animations: "disabled",
          maxDiffPixelRatio: 0.01,
        });
      }
    });
  }

  test("workspace menu keeps production density and elevation", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await page.getByRole("button", { name: "Workspace menu" }).click();

    const menu = page.getByRole("menu", { name: "Actions" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toHaveCSS("min-height", "28px");

    if (hasLocalSnapshotBaseline) {
      await expect(menu).toHaveScreenshot("workspace-actions-menu.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    }
  });

  test("mobile navigation sheet matches production height", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWiki(page, "/wiki/logistics/insurance");
    await page.getByTestId("bottom-nav-trigger").click();

    const sheet = page.getByTestId("bottom-nav-sheet");
    await expect(sheet.locator(".wiki-shell-bottom-nav-panel")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, 0, 0)",
    );

    if (hasLocalSnapshotBaseline) {
      await expect(sheet).toHaveScreenshot("mobile-navigation-sheet.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    }
  });
});
