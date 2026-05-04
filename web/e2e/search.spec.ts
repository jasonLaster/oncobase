import { test, expect, type Locator, type Page } from "@playwright/test";

const SEARCH_QUERY = "multicentric";
const DIAGNOSIS_RESULT = "a[href='/wiki/diagnostics/diagnosis']";
const isProdSearchRun = process.env.TEST_ENV === "prod";
const AI_RESULTS_QUERY = "mock ai ranked results";
const AI_LINK_QUERY = "mock ai result links";
const AI_TAGS_QUERY = "mock ai result tags";
const AI_ERROR_QUERY = "mock ai error response";
const AI_HTML_ERROR_QUERY = "mock ai html failure";

const mockAIResults = {
  results: [
    {
      slug: "wiki/treatment/keynote-522",
      title: "KEYNOTE-522 Protocol",
      tags: ["treatment", "immunotherapy"],
      relevance: 9,
      summary: "Core treatment protocol for this TNBC case.",
    },
    {
      slug: "wiki/diagnostics/diagnosis",
      title: "Diagnosis Overview",
      tags: ["diagnostics"],
      relevance: 7,
      summary: "Initial diagnosis and staging details.",
    },
  ],
};

async function mockAISearch(page: Page, response: Record<string, unknown> = mockAIResults, status = 200) {
  let calls = 0;

  await page.context().route("**/api/ai-search", (route) => {
    calls += 1;
    return route.fulfill({
      headers: { "cache-control": "no-store" },
      status,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });

  return {
    async waitForRequest() {
      await expect
        .poll(() => calls, { timeout: 20_000 })
        .toBeGreaterThan(0);
    },
  };
}

async function openTextSearch(page: Page) {
  const textSearchBtn = page.getByRole("button", { name: "Text Search" });
  await expect(textSearchBtn).toBeVisible({ timeout: 10_000 });
  await textSearchBtn.click();
}

async function waitForVisible(locator: Locator, timeout = 45_000) {
  await expect
    .poll(async () => locator.isVisible().catch(() => false), { timeout })
    .toBe(true);
}

async function waitForTextSearchState(page: Page) {
  await waitForVisible(
    page.getByText(/\d+ results? in \d+ files?|No results for/).first()
  );
}

test.describe("Search", () => {
  test.describe.configure({ timeout: 60_000 });

  test("search from header bar navigates to results", async ({ page }) => {
    await mockAISearch(page);
    await page.goto("/");
    const searchInput = page.locator("header").locator('input[name="q"]');
    await expect(searchInput).toBeEditable({ timeout: 10_000 });
    // The form's onSubmit handler is attached during React hydration.
    // Pressing Enter before hydration triggers a native GET against the
    // current URL (the form has no action attribute) and we land on "/"
    // instead of "/search?q=…".
    await page.waitForTimeout(1_000);
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

    await page.goto(`/search?q=${SEARCH_QUERY}`);
    await openTextSearch(page);
    await waitForVisible(page.locator(DIAGNOSIS_RESULT).first());
    await waitForVisible(page.getByText(/\d+ results? in \d+ files?/).first());
  });

  test("empty search shows no results message", async ({ page }) => {
    await page.goto("/search?q=zzzznonexistentquery999");
    await openTextSearch(page);
    await waitForTextSearchState(page);
    await expect(
      page.getByText("No results for").first()
    ).toBeVisible();
  });

  test("AI mode shows ranked results", async ({ page }) => {
    const aiSearch = await mockAISearch(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_RESULTS_QUERY)}`);
    await aiSearch.waitForRequest();
    // AI mode is the default tab — wait for results
    await expect(page.getByText("9/10").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ranked by relevance").first()).toBeVisible();
    await expect(page.getByText("Diagnosis Overview").first()).toBeVisible();
    await expect(page.getByText("7/10").first()).toBeVisible();
  });

  test("AI mode results link to wiki pages", async ({ page }) => {
    const aiSearch = await mockAISearch(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_LINK_QUERY)}`);
    await aiSearch.waitForRequest();
    const link = page.locator("a[href='/wiki/treatment/keynote-522']");
    await expect(link.first()).toBeVisible({ timeout: 15_000 });
  });

  test("AI mode shows tags on results", async ({ page }) => {
    const aiSearch = await mockAISearch(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_TAGS_QUERY)}`);
    await aiSearch.waitForRequest();
    await expect(page.getByText("9/10").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("immunotherapy").first()).toBeVisible();
  });

  test("AI mode shows no results for unknown query", async ({ page }) => {
    const aiSearch = await mockAISearch(page, { results: [] });
    await page.goto("/search?q=zzzznonexistentquery999");
    await aiSearch.waitForRequest();
    await expect(
      page.getByText("No relevant results for").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("AI mode shows error when API fails", async ({ page }) => {
    const aiSearch = await mockAISearch(
      page,
      { results: [], error: "API key limit reached." },
      402
    );
    await page.goto(`/search?q=${encodeURIComponent(AI_ERROR_QUERY)}`);
    await aiSearch.waitForRequest();
    await expect(
      page.getByText("Search failed").first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("AI mode shows readable error when API returns a non-JSON failure", async ({ page }) => {
    let calls = 0;
    await page.context().route("**/api/ai-search", (route) => {
      calls += 1;
      return route.fulfill({
        headers: { "cache-control": "no-store" },
        status: 500,
        contentType: "text/html",
        body: "<html><body>Internal Server Error</body></html>",
      });
    });

    await page.goto(`/search?q=${encodeURIComponent(AI_HTML_ERROR_QUERY)}`);
    await expect
      .poll(() => calls, { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(
      page.getByText("Search failed with 500 Internal Server Error.").first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
