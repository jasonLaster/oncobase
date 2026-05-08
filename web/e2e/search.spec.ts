import { test, expect, type Page } from "@playwright/test";
import { mockAISearch } from "./ai-search-mock";
import { waitForVisible } from "./helpers";

const SEARCH_QUERY = "multicentric";
const DIAGNOSIS_RESULT = "a[href='/wiki/diagnostics/diagnosis']";
const isProdSearchRun = process.env.TEST_ENV === "prod";
const AI_RESULTS_QUERY = "mock ai ranked results";
const AI_LINK_QUERY = "mock ai result links";
const AI_TAGS_QUERY = "mock ai result tags";
const AI_ERROR_QUERY = "mock ai error response";
const AI_HTML_ERROR_QUERY = "mock ai html failure";

async function openTextSearch(page: Page) {
  const textSearchBtn = page.getByTestId("search-tab-text");
  await expect(textSearchBtn).toBeVisible({ timeout: 10_000 });
  await textSearchBtn.click();
}

async function waitForTextSearchState(page: Page) {
  await expect
    .poll(
      async () =>
        (await page.getByTestId("search-text-summary").count()) +
        (await page.getByTestId("search-text-empty").count()),
      { timeout: 45_000 }
    )
    .toBeGreaterThan(0);
}

test.describe("Search", () => {
  test.describe.configure({ timeout: 60_000 });

  test("search from header bar navigates to results", async ({ page }) => {
    await mockAISearch(page);
    await page.goto("/");
    const searchInput = page.getByTestId("header-search-input");
    await expect(searchInput).toBeEditable({ timeout: 10_000 });
    await expect(page.getByTestId("header-search-form")).toHaveAttribute(
      "data-hydrated",
      "true"
    );
    await searchInput.fill(SEARCH_QUERY);
    await searchInput.press("Enter");

    await expect(page).toHaveURL(new RegExp(`/search\\?q=${SEARCH_QUERY}$`));
    await openTextSearch(page);
    if (isProdSearchRun) {
      await waitForVisible(page.locator(DIAGNOSIS_RESULT).first());
      await waitForVisible(page.getByText(/\d+ results? in \d+ files?/).first());
      return;
    }

    await waitForTextSearchState(page);
  });

  test("search results contain relevant pages", async ({ page }) => {
    test.skip(!isProdSearchRun, "Text search relevance is validated against production-like builds.");

    await mockAISearch(page);
    await page.goto(`/search?q=${SEARCH_QUERY}`);
    await openTextSearch(page);
    await waitForVisible(page.locator(DIAGNOSIS_RESULT).first());
    await waitForVisible(page.getByText(/\d+ results? in \d+ files?/).first());
  });

  test("empty search shows no results message", async ({ page }) => {
    await mockAISearch(page);
    await page.goto("/search?q=zzzznonexistentquery999");
    await openTextSearch(page);
    await waitForTextSearchState(page);
    await expect(page.getByTestId("search-text-empty")).toBeVisible();
  });

  test("AI mode shows ranked results", async ({ page }) => {
    const aiSearch = await mockAISearch(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_RESULTS_QUERY)}`);
    await aiSearch.waitForRequest();
    // AI mode is the default tab — wait for results
    await expect(page.getByTestId("search-ai-summary")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("search-ai-result").first()).toContainText(
      "9/10"
    );
    await expect(page.getByText("Diagnosis Overview").first()).toBeVisible();
    await expect(page.getByText("7/10").first()).toBeVisible();
  });

  test("AI mode results link to wiki pages", async ({ page }) => {
    const aiSearch = await mockAISearch(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_LINK_QUERY)}`);
    await aiSearch.waitForRequest();
    const link = page
      .getByTestId("search-ai-result")
      .and(page.locator("a[href='/wiki/treatment/keynote-522']"));
    await expect(link.first()).toBeVisible({ timeout: 15_000 });
  });

  test("AI mode shows tags on results", async ({ page }) => {
    const aiSearch = await mockAISearch(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_TAGS_QUERY)}`);
    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-result").first()).toContainText("9/10", {
      timeout: 15_000,
    });
    await expect(page.getByText("immunotherapy").first()).toBeVisible();
  });

  test("AI mode shows no results for unknown query", async ({ page }) => {
    const aiSearch = await mockAISearch(page, { body: { results: [] } });
    await page.goto("/search?q=zzzznonexistentquery999");
    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-empty")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("AI mode shows error when API fails", async ({ page }) => {
    const aiSearch = await mockAISearch(page, {
      body: { results: [], error: "API key limit reached." },
      status: 402,
    });
    await page.goto(`/search?q=${encodeURIComponent(AI_ERROR_QUERY)}`);
    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-error")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("AI mode shows readable error when API returns a non-JSON failure", async ({ page }) => {
    const aiSearch = await mockAISearch(page, {
      body: "<html><body>Internal Server Error</body></html>",
      contentType: "text/html",
      status: 500,
    });

    await page.goto(`/search?q=${encodeURIComponent(AI_HTML_ERROR_QUERY)}`);
    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-error")).toContainText(
      "Search failed with 500 Internal Server Error.",
      { timeout: 15_000 }
    );
  });
});
