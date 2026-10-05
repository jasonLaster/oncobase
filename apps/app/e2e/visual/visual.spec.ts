import { expect, test, type Page } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "../fixtures";

const dynamicMasks = (page: Page) => [
  page.locator(".metrics-panel"),
  page.locator(".topbar-status"),
  page.locator(".page-footer"),
];

// Baselines use macOS fonts. The dedicated macOS CI job compares them; Linux
// shards skip pixel comparison and rely on the overflow sweep below.
const hasLocalSnapshotBaseline = process.platform === "darwin";

test.describe("visual", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("desktop reader shell", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await expect(page.getByTestId("document-article")).toBeVisible();
    await expect(page.locator(".wiki-shell-outline-root")).toBeVisible();
    test.skip(!hasLocalSnapshotBaseline, "Pixel baselines are macOS-only.");
    await expect(page.locator(".wiki-shell-outline-root")).toHaveScreenshot(
      "desktop-reader-shell.png",
      { animations: "disabled", mask: dynamicMasks(page), maxDiffPixelRatio: 0.02 },
    );
  });

  test("mobile reader shell", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await expect(page.getByTestId("mobile-page-header")).toBeVisible();
    test.skip(!hasLocalSnapshotBaseline, "Pixel baselines are macOS-only.");
    await expect(page.locator(".page-shell")).toHaveScreenshot("mobile-reader-shell.png", {
      animations: "disabled",
      mask: dynamicMasks(page),
      maxDiffPixelRatio: 0.02,
    });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`command palette ${theme}`, async ({ page }) => {
      await page.addInitScript((nextTheme) => localStorage.setItem("theme", nextTheme), theme);
      await gotoWiki(page, "/");
      await page.getByTestId("sidebar-search").click();
      const palette = page.getByTestId("command-palette");
      await expect(palette).toBeVisible();
      await expect(palette.getByRole("option").first()).toBeVisible();
      test.skip(!hasLocalSnapshotBaseline, "Pixel baselines are macOS-only.");
      await expect(palette).toHaveScreenshot(`file-palette-${theme}.png`, {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});

test.describe("signed-out visual", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("landing page hero", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "It takes a village.", level: 1 })).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".lp-hero img")
          .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete)),
      )
      .toBe(true);
    test.skip(!hasLocalSnapshotBaseline, "Pixel baselines are macOS-only.");
    await expect(page).toHaveScreenshot("landing-hero.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
    });
  });

  // One sweep replaces the per-page "reflows without overflow at Npx" tests.
  test("public routes never overflow horizontally at phone, tablet, and desktop widths", async ({
    page,
  }) => {
    const routes = ["/login", "/sign-in", "/features", "/compare", "/terms-and-conditions"];
    if (process.env.PLAYWRIGHT_BASE_URL) routes.push("/education", "/education/oncology-101/index");
    const overflowing: string[] = [];
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route, { waitUntil: "load" });
        await expect(page.locator("h1").first()).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (overflow > 0) overflowing.push(`${route} @${width}px (+${overflow}px)`);
      }
    }
    expect(overflowing).toEqual([]);
  });
});
