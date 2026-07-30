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
    await expect(page.getByTestId("document-article")).toHaveCSS("padding-right", "32px");
    await expect(page.locator(":root")).toHaveCSS(
      "font-family",
      "ui-sans-serif, system-ui, sans-serif",
    );
    await expect(page.locator(".wiki-shell-page-header")).toHaveCSS("min-height", "48px");
    expect((await page.locator(".wiki-shell-page-header").boundingBox())?.height).toBe(48);
    await expect(page.getByTestId("sidebar-workspace-trigger")).toHaveCSS("font-size", "16px");
    await expect(
      page.getByTestId("wiki-sidebar").getByTestId("sidebar-sign-in"),
    ).toHaveCSS("min-height", "42px");
    await expect(page.locator(".wiki-shell-tree-directory").first()).toHaveCSS(
      "font-size",
      "16px",
    );
    const collapseButton = page.locator(".sidebar-collapse-button");
    await expect(collapseButton).toHaveCSS("width", "24px");
    await expect(collapseButton).toHaveCSS("border-radius", "8px");

    const commentsButtonBox = await page
      .getByRole("button", { name: "Open comments" })
      .boundingBox();
    const outlineButtonBox = await page
      .getByRole("button", { name: "Open outline" })
      .boundingBox();
    const articleBox = await page.getByTestId("document-article").boundingBox();
    expect(commentsButtonBox).toEqual({
      x: 1234,
      y: 12,
      width: 28,
      height: 28,
    });
    expect(outlineButtonBox).toEqual({
      x: 1234,
      y: 48,
      width: 28,
      height: 28,
    });
    expect(articleBox?.y).toBe(32);

    if (hasLocalSnapshotBaseline) {
      await expect(page.locator(".wiki-shell-outline-root")).toHaveScreenshot("desktop-reader-shell.png", {
        animations: "disabled",
        mask: dynamicMasks(page),
        maxDiffPixelRatio: 0.02,
      });
    }
  });

  test("markdown lists keep the production reader line height", async ({ page }) => {
    await gotoWiki(page, "/");
    await waitForPageTitle(page, "Diana Wiki Home");

    const listItems = page.locator(".wiki-markdown li");
    await expect(listItems).toHaveCount(5);
    await expect(listItems.first()).toHaveCSS("font-size", "16px");
    await expect(listItems.first()).toHaveCSS("line-height", "25.6px");
    const itemHeights = await listItems.evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().height),
    );
    expect(itemHeights).toEqual([25.59375, 25.59375, 25.59375, 25.59375, 25.59375]);
  });

  test("collapsed desktop sidebar keeps its expand control at the top", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await page.locator(".sidebar-collapse-button").click();

    const rail = page.locator("[data-sidebar-collapsed-rail]");
    const expandButton = rail.getByRole("button", { name: "Expand sidebar" });
    await expect(rail).toBeVisible();
    await expect(expandButton).toBeVisible();

    const railBox = await rail.boundingBox();
    const buttonBox = await expandButton.boundingBox();
    expect(railBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y - railBox!.y).toBe(8);
    expect(buttonBox!.width).toBe(30);
    expect(buttonBox!.height).toBe(30);
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
    await expect(page.getByTestId("document-article")).toHaveCSS("padding-right", "16px");
    await expect(page.locator(".wiki-vite-mobile-title")).toHaveCSS("font-size", "16px");
    const mobileHeaderBox = await page.getByTestId("mobile-page-header").boundingBox();
    const mobileTitleBox = await page.locator(".wiki-vite-mobile-title").boundingBox();
    expect(mobileHeaderBox).not.toBeNull();
    expect(mobileTitleBox).not.toBeNull();
    expect(mobileTitleBox!.y - mobileHeaderBox!.y).toBe(14.75);
    expect(mobileTitleBox!.height).toBe(17.5);
    for (const testId of ["mobile-header-search", "mobile-header-comments"]) {
      const iconBox = await page.getByTestId(testId).locator("svg").boundingBox();
      expect(iconBox).not.toBeNull();
      expect(iconBox!.width).toBe(18);
      expect(iconBox!.height).toBe(18);
    }

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
    await expect(menu).toBeFocused();
    await expect(menu.getByRole("menuitem").first()).toHaveCSS("min-height", "28px");
    await expect(menu.getByRole("menuitem").first()).toHaveCSS("line-height", "20px");
    await expect(menu.getByRole("menuitem").first()).toHaveCSS("border-radius", "8px");
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBe(8);
    expect(menuBox!.y).toBe(46);
    expect(menuBox!.width).toBe(224);
    expect(menuBox!.height).toBe(218);
    expect((await menu.getByRole("menuitem").first().boundingBox())?.height).toBe(28);
    const menuItemOffsets = await menu.getByRole("menuitem").evaluateAll(
      (items, menuTop) =>
        items.map((item) => item.getBoundingClientRect().y - menuTop),
      menuBox!.y,
    );
    expect(menuItemOffsets).toEqual([28, 56, 93, 130, 158, 186]);
    await expect(menu).toHaveCSS("border-radius", "10px");

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
    await expect(sheet.getByText("Pages", { exact: true })).toHaveCount(0);
    await expect(sheet.getByText("Outline", { exact: true })).toHaveCount(1);
    await expect(sheet.getByRole("button", { name: "Page nav" })).toHaveCSS(
      "font-size",
      "16px",
    );
    await expect(sheet.getByRole("button", { name: "Page nav" })).toHaveCSS(
      "min-height",
      "36px",
    );
    await expect(sheet.getByTestId("sidebar-sign-in")).toHaveCSS("font-size", "16px");
    await expect(sheet.locator(".wiki-shell-tree-directory").first()).toHaveCSS(
      "font-size",
      "16px",
    );
    const panelBox = await sheet.locator(".wiki-shell-bottom-nav-panel").boundingBox();
    const closeBox = await sheet.getByRole("button", { name: "Close navigation" }).boundingBox();
    const pageNavBox = await sheet.getByRole("button", { name: "Page nav" }).boundingBox();
    const signInBox = await sheet.getByTestId("sidebar-sign-in").boundingBox();
    expect(panelBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(pageNavBox).not.toBeNull();
    expect(signInBox).not.toBeNull();
    expect(closeBox!.x).toBe(352);
    expect(closeBox!.y - panelBox!.y).toBe(20);
    expect(closeBox!.width).toBe(28);
    expect(closeBox!.height).toBe(28);
    expect(pageNavBox!.x).toBe(19);
    expect(pageNavBox!.y - panelBox!.y).toBe(63);
    expect(Math.abs(pageNavBox!.width - 175)).toBeLessThanOrEqual(1);
    expect(Math.abs(signInBox!.y - panelBox!.y - 215.5)).toBeLessThan(1);

    if (hasLocalSnapshotBaseline) {
      await expect(sheet).toHaveScreenshot("mobile-navigation-sheet.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    }
  });

  test("mobile search header matches production controls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/search", { waitUntil: "domcontentloaded" });

    const header = page.getByTestId("mobile-page-header");
    await expect(header.locator(".wiki-vite-mobile-title")).toHaveText("Search");
    await expect(header.locator(".wiki-vite-mobile-title")).toHaveCSS("font-size", "16px");
    const titleBox = await header.locator(".wiki-vite-mobile-title").boundingBox();
    expect(titleBox).not.toBeNull();
    expect(titleBox!.y).toBe(14.75);
    expect(titleBox!.height).toBe(17.5);
    await expect(header.getByRole("button")).toHaveCount(2);
    const searchIconBox = await page.getByTestId("mobile-header-search").locator("svg").boundingBox();
    expect(searchIconBox).not.toBeNull();
    expect(searchIconBox!.width).toBe(18);
    expect(searchIconBox!.height).toBe(18);

    if (hasLocalSnapshotBaseline) {
      await expect(header).toHaveScreenshot("mobile-search-header.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    }
  });

  test("password gate matches production control density", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const card = page.locator(".auth-card");
    const input = page.getByRole("textbox", { name: "Password" });
    const button = page.getByRole("button", { name: "Enter" });
    const cardBox = await card.boundingBox();
    const inputBox = await input.boundingBox();
    const buttonBox = await button.boundingBox();

    expect(cardBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(cardBox!.width).toBe(384);
    expect(cardBox!.height).toBe(202);
    expect(Math.abs(cardBox!.y - (page.viewportSize()!.height - cardBox!.height) / 2)).toBeLessThan(1);
    expect(inputBox!.width).toBe(320);
    expect(inputBox!.height).toBe(36);
    expect(buttonBox!.width).toBe(320);
    expect(buttonBox!.height).toBe(34);
  });
});
