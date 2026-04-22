import { test, expect, type Page } from "@playwright/test";

const mockAIResults = {
  results: [
    {
      slug: "wiki/treatment/keynote-522",
      title: "KEYNOTE-522 Protocol",
      tags: ["treatment", "immunotherapy"],
      relevance: 9,
      summary: "Core treatment protocol for Diana's TNBC case.",
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

function mockAISearch(page: Page, response: Record<string, unknown> = mockAIResults, status = 200) {
  return page.route("**/api/ai-search", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(response),
    })
  );
}

test.describe("Search", () => {
  test("search from header bar navigates to results", async ({ page }) => {
    await mockAISearch(page);
    await page.goto("/");
    const searchInput = page.locator("header").locator('input[name="q"]');
    await expect(searchInput).toBeEditable({ timeout: 10_000 });
    await searchInput.fill("diagnosis");
    await searchInput.press("Enter");

    await expect(page).toHaveURL(/\/search\?q=diagnosis/);
    // Switch to text search tab (wait for it to appear after page load)
    const textSearchBtn = page.getByRole("button", { name: "Text Search" });
    await expect(textSearchBtn).toBeVisible({ timeout: 10_000 });
    await textSearchBtn.click();
    // Wait for results to load - the summary text "X results in Y files"
    await expect(
      page.getByText(/\d+ results? in \d+ files?/).first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test("search results contain relevant pages", async ({ page }) => {
    await page.goto("/search?q=diagnosis");
    // Switch to text search tab
    await page.getByRole("button", { name: "Text Search" }).click();
    await expect(
      page.locator("a[href='/wiki/diagnostics/diagnosis']").first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/\d+ results? in \d+ files?/).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("empty search shows no results message", async ({ page }) => {
    await page.goto("/search?q=zzzznonexistentquery999");
    // Switch to text search tab
    await page.getByRole("button", { name: "Text Search" }).click();
    await expect(
      page.getByText("No results for").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("AI mode shows ranked results", async ({ page }) => {
    await mockAISearch(page);
    await page.goto("/search?q=treatment");
    // AI mode is the default tab — wait for results
    await expect(page.getByText("9/10").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("ranked by relevance").first()).toBeVisible();
    await expect(page.getByText("Diagnosis Overview").first()).toBeVisible();
    await expect(page.getByText("7/10").first()).toBeVisible();
  });

  test("AI mode results link to wiki pages", async ({ page }) => {
    await mockAISearch(page);
    await page.goto("/search?q=treatment");
    const link = page.locator("a[href='/wiki/treatment/keynote-522']");
    await expect(link.first()).toBeVisible({ timeout: 10_000 });
  });

  test("AI mode shows tags on results", async ({ page }) => {
    await mockAISearch(page);
    await page.goto("/search?q=treatment");
    await expect(page.getByText("9/10").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("immunotherapy").first()).toBeVisible();
  });

  test("AI mode shows no results for unknown query", async ({ page }) => {
    await mockAISearch(page, { results: [] });
    await page.goto("/search?q=zzzznonexistentquery999");
    await expect(
      page.getByText("No relevant results for").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("AI mode shows error when API fails", async ({ page }) => {
    await mockAISearch(
      page,
      { results: [], error: "API key limit reached." },
      402
    );
    await page.goto("/search?q=treatment");
    await expect(
      page.getByText("Search failed").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("AI mode shows readable error when API returns a non-JSON failure", async ({ page }) => {
    await page.route("**/api/ai-search", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/html",
        body: "<html><body>Internal Server Error</body></html>",
      })
    );

    await page.goto("/search?q=treatment");
    await expect(
      page.getByText("Search failed with 500 Internal Server Error.").first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
