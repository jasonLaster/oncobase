import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  nextErrorOverlay,
  openDirectory,
  waitForPageTitle,
} from "./fixtures";

test.describe("Page load experience", () => {
  test("initial paint keeps header, sidebar, metrics, and article chrome", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.getByTestId("app-header")).toBeVisible();
    await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
    await expect(page.locator(".metrics-panel")).toBeVisible();
    await expect(page.locator(".metrics-panel")).toContainText("route");
    await expect(page.locator(".metrics-panel")).toContainText("body misses");
    await waitForPageTitle(page, "Insurance");
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("mobile initial paint keeps header and bottom page affordance", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.getByTestId("app-header")).toBeVisible();
    await expect(page.getByTestId("bottom-nav-trigger")).toBeVisible();
    await expect(page.getByTestId("bottom-nav-trigger")).toContainText("insurance");
  });

  test("warm navigation reuses the local page body cache", async ({ page }) => {
    const requests = await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    requests.pages.length = 0;
    await page.getByTestId("app-header").getByRole("link", { name: "Home" }).click();
    await waitForPageTitle(page, "Diana Wiki Home");
    await openDirectory(page, "logistics");
    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }).click();
    await waitForPageTitle(page, "Insurance");

    const bodyFetches = requests.pages.filter((url) =>
      url.includes("slugs=wiki%2Flogistics%2Finsurance") ||
      url.includes("slugs=wiki/logistics/insurance"),
    );
    expect(bodyFetches).toHaveLength(0);
    await expect(page.locator(".metrics-panel")).toContainText("warm");
    await expect(documentArticle(page)).toContainText("Claims follow-up");
  });
});
