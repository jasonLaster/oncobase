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
      page.getByTestId("wiki-sidebar").getByRole("button", { name: "Collapse wiki" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("sidebar directory expansion persists across reloads", async ({ page }) => {
    await gotoWiki(page, "/");

    await openDirectory(page, "logistics");
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" })).toBeVisible();
  });

  test("sidebar lets users collapse the active branch and persists the choice", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const sidebar = page.getByTestId("wiki-sidebar");
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeVisible();
    await sidebar.getByRole("button", { name: "Collapse wiki" }).click();
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeHidden();

    await page.reload();
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeHidden();

    await sidebar.getByRole("button", { name: "Expand wiki" }).click();
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeVisible();
  });

  test("sidebar hides image-only asset directories while asset tools keep images available", async ({ page }) => {
    await gotoWiki(page, "/");

    await expect(page.getByTestId("wiki-sidebar").getByRole("button", { name: /images/i })).toHaveCount(0);
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: /pathology-slide/ })).toHaveCount(0);

    await page.getByTestId("command-palette-trigger").click();
    await page.getByRole("button", { name: "Assets" }).click();
    await page.getByTestId("command-palette-input").fill("pathology");
    await expect(
      page.getByTestId("command-palette").getByRole("link", { name: /pathology-slide.png/ }),
    ).toBeVisible();
  });

  test("sidebar rail can collapse, expand, resize, and persist width", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await gotoWiki(page, "/");

    const layout = page.locator("[data-sidebar-layout]");
    const expandedRail = page.locator("[data-sidebar-expanded-rail]").first();
    await expect(layout).toHaveAttribute("data-sidebar-state", "expanded");
    await expect(expandedRail).toBeVisible();
    await expect(expandedRail).toHaveCSS("width", "256px");

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(layout).toHaveAttribute("data-sidebar-state", "collapsed");
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(page.getByTestId("wiki-sidebar")).toBeHidden();

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(layout).toHaveAttribute("data-sidebar-state", "expanded");

    const handle = page.locator("[data-sidebar-resize-handle]");
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 30);
    await page.mouse.down();
    await page.mouse.move(box!.x + 96, box!.y + 30);
    await page.mouse.up();
    await expect
      .poll(async () => Number.parseFloat(await expandedRail.evaluate((node) => getComputedStyle(node).width)))
      .toBeGreaterThan(340);

    await page.reload();
    await expect
      .poll(async () => Number.parseFloat(await expandedRail.evaluate((node) => getComputedStyle(node).width)))
      .toBeGreaterThan(340);
  });

  test("page shows tags, sensitive scope, and cache metadata", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

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
