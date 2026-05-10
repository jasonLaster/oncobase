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

  test("unknown deep links render a not-found shell after manifest sync", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/missing/not-here");

    await expect(documentArticle(page).locator("h1")).toHaveText("Page not found");
    await expect(documentArticle(page)).toContainText("wiki/missing/not-here");
    await expect(documentArticle(page).getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  test("failed current-page markdown fetch exposes a retry action", async ({ page }) => {
    const slug = "wiki/logistics/insurance";
    const requests = await installWikiApiMocks(page, { pageFailures: { [slug]: true } });
    await gotoWiki(page, `/${slug}`);

    await expect(documentArticle(page).locator("h1")).toHaveText("Insurance");
    await expect(documentArticle(page)).toContainText("could not be fetched");
    requests.setPageFailure(slug, 0);
    await page.getByTestId("retry-page-fetch").click();

    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Prior authorization");
  });

  test("storage pressure appears when browser quota is tight", async ({ page }) => {
    await page.addInitScript(() => {
      const originalStorage = navigator.storage;
      const storage = Object.create(Object.getPrototypeOf(originalStorage)) as StorageManager;
      storage.estimate = async () => ({ usage: 960, quota: 1000 });
      storage.getDirectory = originalStorage.getDirectory.bind(originalStorage);
      storage.persist = originalStorage.persist.bind(originalStorage);
      storage.persisted = originalStorage.persisted.bind(originalStorage);
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: storage,
      });
    });
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    const metrics = page.locator(".metrics-panel");
    await expect(metrics).toContainText("cache pressure");
    await expect(metrics).toContainText("96%");
  });
});
