import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  nextErrorOverlay,
  openDirectory,
  waitForPageTitle,
} from "./fixtures";

test.describe("Page viewing and sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("home page loads with wiki content", async ({ page }) => {
    await gotoWiki(page, "/");

    await waitForPageTitle(page, "Diana Wiki Home");
    await expect(page.getByTestId("app-header")).toBeVisible();
    await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
    await expect(documentArticle(page)).toContainText("local Vite reader fixture");
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("navigates to a page via sidebar", async ({ page }) => {
    await gotoWiki(page, "/");

    await openDirectory(page, "logistics");
    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }).click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Prior authorization");
  });

  test("deep links auto-expand the active sidebar branch", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const sidebar = page.getByTestId("wiki-sidebar");
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "insurance" })).toHaveClass(/active/);
  });

  test("sidebar exposes accessible expansion and current-page state", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(
      page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByTestId("wiki-sidebar").getByRole("button", { name: "wiki" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("sidebar directory expansion persists across reloads", async ({ page }) => {
    await gotoWiki(page, "/");

    await openDirectory(page, "logistics");
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" })).toBeVisible();
  });

  test("page shows tags, sensitive scope, and cache metadata", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(documentArticle(page).locator(".tag-row").getByRole("link", { name: "logistics" })).toBeVisible();
    await expect(documentArticle(page).locator(".tag-row").getByRole("link", { name: "insurance" })).toBeVisible();
    await expect(documentArticle(page).locator(".page-footer")).toContainText("Content hash:");
    await expect(page.getByTestId("scope-switcher").getByRole("link", { name: "Public" })).toHaveClass(/active/);
  });

  test("local quick switcher opens with Ctrl+K and navigates on Enter", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeFocused();
    await input.fill("insurance");
    await expect(page.getByTestId("command-palette").getByRole("button", { name: /Insurance/ })).toBeVisible();
    await input.press("Enter");

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await waitForPageTitle(page, "Insurance");
  });
});
