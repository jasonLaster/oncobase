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
  test("renders a Log-sized markdown body through the tail", async ({ page }) => {
    const largeLogContent = [
      "# Log",
      "",
      "## Sunday, May 10th",
      "",
      "LOG_TOP_SENTINEL The rendered page should include the newest log entry.",
      "",
      Array.from(
        { length: 2300 },
        (_, index) =>
          `Audit paragraph ${index + 1}. The Vite reader must preserve complete markdown body text across manifest refreshes, LiveStore materialization, markdown rendering, and page chrome updates without silently trimming the document.`,
      ).join("\n\n"),
      "",
      "## Middle checkpoint",
      "",
      "LOG_MIDDLE_SENTINEL This marker protects the middle of a large markdown body.",
      "",
      Array.from(
        { length: 900 },
        (_, index) =>
          `Continuation paragraph ${index + 1}. Long wiki pages such as about/Log should remain faithful to the markdown source even when they are larger than common article pages.`,
      ).join("\n\n"),
      "",
      "## Friday, March 13th",
      "",
      "LOG_TAIL_SENTINEL Core biopsy at outside facility.",
      "",
    ].join("\n");

    await installWikiApiMocks(page, {
      pageOverrides: {
        "about/Log": {
          title: "Log",
          tags: ["about", "log"],
          description: "Large log fixture",
          content: largeLogContent,
        },
      },
    });

    await gotoWiki(page, "/about/Log");
    await waitForPageTitle(page, "Log");

    const article = documentArticle(page);
    await expect(article).toContainText("LOG_TOP_SENTINEL");
    await expect(article).toContainText("LOG_MIDDLE_SENTINEL");
    await expect(article).toContainText("LOG_TAIL_SENTINEL");
  });

  test("initial paint keeps header, sidebar, and article chrome without diagnostics", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.getByTestId("app-header")).toBeVisible();
    await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
    await expect(page.getByTestId("metrics-panel")).toHaveCount(0);
    await expect(page.getByTestId("livestore-devtools-footer")).toHaveCount(0);
    await waitForPageTitle(page, "Insurance");
    await expect(nextErrorOverlay(page)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => window.__WIKI_VITE_OBSERVABILITY__?.metrics?.lastRouteRenderMs ?? -1),
      )
      .toBeGreaterThanOrEqual(0);
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
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");
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
    await expect(page.getByTestId("metrics-panel")).toContainText("warm");
    await expect(documentArticle(page)).toContainText("Claims follow-up");
  });

  test("cold route fetches the current page body before eager markdown", async ({ page }) => {
    const requests = await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    expect(requests.pages.length).toBeGreaterThan(0);
    const firstPageRequest = new URL(requests.pages[0]);
    expect(firstPageRequest.searchParams.get("slugs")).toBe("wiki/logistics/insurance");
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

  test("manifest failures show a bounded retry state instead of an infinite loader", async ({ page }) => {
    await installWikiApiMocks(page, { manifestFailure: true });
    await page.goto("/wiki/logistics/insurance", { waitUntil: "domcontentloaded" });

    await expect(documentArticle(page).locator("h1")).toHaveText("Markdown unavailable");
    await expect(documentArticle(page)).toContainText("Wiki request failed: 503");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    await expect(page.getByTestId("retry-page-fetch")).toBeVisible();
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
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    const metrics = page.getByTestId("metrics-panel");
    await expect(metrics).toContainText("cache pressure");
    await expect(metrics).toContainText("96%");
  });
});
