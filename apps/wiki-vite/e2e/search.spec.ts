import { expect, test, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

const SEARCH_QUERY = "diagnosis";
const AI_RESULTS_QUERY = "mock ai ranked results";
const AI_LINK_QUERY = "mock ai result links";
const AI_TAGS_QUERY = "mock ai result tags";
const AI_ERROR_QUERY = "mock ai error response";
const AI_HTML_ERROR_QUERY = "mock ai html failure";

const mockAIResults = {
  results: [
    {
      slug: "wiki/diagnostics/diagnosis",
      title: "Diagnosis Overview",
      tags: ["diagnostics"],
      relevance: 9,
      summary: "Initial diagnosis and staging details match this query.",
    },
    {
      slug: "wiki/logistics/insurance",
      title: "Insurance",
      tags: ["logistics", "coverage"],
      relevance: 7,
      summary: "Coverage notes are indirectly relevant to diagnosis logistics.",
    },
  ],
};

type MockSearchOptions = {
  body?: Record<string, unknown> | string;
  contentType?: string;
  status?: number;
};

async function mockTextSearch(
  page: Page,
  {
    body = {
      results: [
        {
          slug: "wiki/diagnostics/diagnosis",
          title: "Diagnosis",
          excerpt: "diagnosis and staging happened recently",
          tags: ["diagnostics"],
        },
      ],
    },
    contentType = "application/json",
    status = 200,
  }: MockSearchOptions = {},
) {
  await page.route("**/api/search?**", (route) =>
    route.fulfill({
      body: typeof body === "string" ? body : JSON.stringify(body),
      contentType,
      status,
    }),
  );
}

async function mockAISearch(
  page: Page,
  {
    body = mockAIResults,
    contentType = "application/json",
    status = 200,
  }: MockSearchOptions = {},
) {
  let calls = 0;

  await page.route("**/api/ai-search", (route) => {
    calls += 1;
    return route.fulfill({
      body: typeof body === "string" ? body : JSON.stringify(body),
      contentType,
      headers: { "cache-control": "no-store" },
      status,
    });
  });

  return {
    async waitForRequest() {
      await expect.poll(() => calls, { timeout: 60_000 }).toBeGreaterThan(0);
    },
  };
}

test.describe("Search and local page finding", () => {
  test("Find files opens local page navigation", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette-input").fill("diagnosis");
    await page.getByRole("option", { name: /Diagnosis/ }).click();

    await expect(page).toHaveURL(/\/wiki\/diagnostics\/diagnosis$/);
    await waitForPageTitle(page, "Diagnosis");
  });

  test("empty local finder shows no results message in the command palette", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette-input").fill("zzzznonexistentquery999");

    await expect(page.getByText("No pages found.")).toBeVisible();
  });

  test("public local finder does not include sensitive pages", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/");

    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette-input").fill("private plan");

    await expect(page.getByText("No pages found.")).toBeVisible();
  });

  test("session finder can include sensitive pages in its separate store", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/?scope=session");

    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette-input").fill("private plan");
    await page.getByRole("option", { name: /Private Plan/ }).click();

    await expect(page).toHaveURL(/\/private\/plan$/);
    await waitForPageTitle(page, "Private Plan");
    await expect(documentArticle(page)).toContainText("Sensitive session-only planning note");
  });

  test("sidebar search and ask affordances expose files and chat handoffs", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByTestId("sidebar-search").click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.getByTestId("command-palette-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sidebar-ask-wiki")).toHaveAttribute("href", "/chat");
  });

  test("search input on /search navigates to results", async ({ page }) => {
    await mockTextSearch(page);
    const aiSearch = await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto("/search", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("BACKEND SEARCH")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Search wiki" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Search" })).toHaveCount(0);

    const searchInput = page.getByTestId("search-form-input");
    await expect(searchInput).toBeEditable({ timeout: 10_000 });
    await searchInput.fill(SEARCH_QUERY);
    await searchInput.press("Enter");

    await expect(page).toHaveURL(new RegExp(`/search\\?q=${SEARCH_QUERY}$`));
    await aiSearch.waitForRequest();
    await expect(page.getByRole("button", { name: "AI Mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("mode toggle matches web labels and default order", async ({ page }) => {
    await mockTextSearch(page);
    await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto(`/search?q=${SEARCH_QUERY}`, { waitUntil: "domcontentloaded" });

    const tabs = page.locator("[data-test-id^='search-tab-']");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toContainText("AI Mode");
    await expect(tabs.nth(1)).toContainText("Text Search");
    await expect(page.getByTestId("search-tab-ai")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("search-tab-ai").locator("svg")).toBeVisible();
  });

  test("search route runs backend text search and opens results", async ({ page }) => {
    await mockTextSearch(page, {
      body: {
        results: [
          {
            slug: "wiki/logistics/insurance",
            title: "Insurance",
            excerpt: "Prior authorization and coverage notes.",
            tags: ["logistics"],
          },
        ],
      },
    });
    await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto("/search?q=insurance&tab=text&returnTo=%2Fwiki%2Flogistics%2Finsurance", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("search-tab-text")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("search-text-summary")).toContainText("1 result");
    await page.getByRole("link", { name: /Insurance/ }).click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await waitForPageTitle(page, "Insurance");
  });

  test("AI mode shows ranked results", async ({ page }) => {
    await mockTextSearch(page);
    const aiSearch = await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_RESULTS_QUERY)}`, {
      waitUntil: "domcontentloaded",
    });

    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-summary")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("search-ai-result").first()).toContainText("9/10");
    await expect(page.getByText("Diagnosis Overview").first()).toBeVisible();
    await expect(page.getByText("7/10").first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__WIKI_VITE_OBSERVABILITY__?.search.at(-1)?.mode))
      .toBe("ai");
  });

  test("AI mode results link to wiki pages", async ({ page }) => {
    await mockTextSearch(page);
    const aiSearch = await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_LINK_QUERY)}`, {
      waitUntil: "domcontentloaded",
    });

    await aiSearch.waitForRequest();
    const link = page
      .getByTestId("search-ai-result")
      .and(page.locator("a[href='/wiki/diagnostics/diagnosis']"));
    await expect(link.first()).toBeVisible({ timeout: 15_000 });
  });

  test("AI mode shows tags on results", async ({ page }) => {
    await mockTextSearch(page);
    const aiSearch = await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_TAGS_QUERY)}`, {
      waitUntil: "domcontentloaded",
    });

    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-result").first()).toContainText("9/10", {
      timeout: 15_000,
    });
    await expect(page.getByText("diagnostics").first()).toBeVisible();
  });

  test("AI mode shows no results for unknown query", async ({ page }) => {
    await mockTextSearch(page, { body: { results: [] } });
    const aiSearch = await mockAISearch(page, { body: { results: [] } });
    await installWikiApiMocks(page);
    await page.goto("/search?q=zzzznonexistentquery999", { waitUntil: "domcontentloaded" });

    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-empty")).toBeVisible({ timeout: 10_000 });
  });

  test("AI mode shows error when API fails", async ({ page }) => {
    await mockTextSearch(page);
    const aiSearch = await mockAISearch(page, {
      body: { results: [], error: "API key limit reached." },
      status: 402,
    });
    await installWikiApiMocks(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_ERROR_QUERY)}`, {
      waitUntil: "domcontentloaded",
    });

    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-error")).toContainText("API key limit reached.", {
      timeout: 15_000,
    });
  });

  test("AI mode shows readable error when API returns a non-JSON failure", async ({ page }) => {
    await mockTextSearch(page);
    const aiSearch = await mockAISearch(page, {
      body: "<html><body>Internal Server Error</body></html>",
      contentType: "text/html",
      status: 500,
    });
    await installWikiApiMocks(page);
    await page.goto(`/search?q=${encodeURIComponent(AI_HTML_ERROR_QUERY)}`, {
      waitUntil: "domcontentloaded",
    });

    await aiSearch.waitForRequest();
    await expect(page.getByTestId("search-ai-error")).toContainText(
      "Search failed with 500 Internal Server Error.",
      { timeout: 15_000 },
    );
  });

  test("text mode renders markdown snippets without raw markdown syntax", async ({ page }) => {
    await mockTextSearch(page, {
      body: {
        results: [
          {
            slug: "wiki/diagnostics/diagnosis",
            title: "Diagnosis",
            excerpt:
              "### Diagnosis context\n\n**diagnosis and staging** happened in [the diagnosis note](/wiki/diagnostics/diagnosis).",
            tags: ["diagnostics"],
          },
        ],
      },
    });
    await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto("/search?q=diagnosis&tab=text", { waitUntil: "domcontentloaded" });

    const result = page.getByTestId("search-text-result").first();
    await expect(result).toContainText("Diagnosis context");
    await expect(result).toContainText("diagnosis and staging");
    await expect(result).not.toContainText("###");
    await expect(result).not.toContainText("**");
    await expect(result).not.toContainText("](");
  });

  test("search results support keyboard selection", async ({ page }) => {
    await mockTextSearch(page, {
      body: {
        results: [
          {
            slug: "wiki/logistics/insurance",
            title: "Insurance",
            excerpt: "Prior authorization and coverage notes.",
            tags: ["logistics"],
          },
          {
            slug: "wiki/diagnostics/diagnosis",
            title: "Diagnosis",
            excerpt: "Diagnosis notes.",
            tags: ["diagnostics"],
          },
        ],
      },
    });
    await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto("/search?q=care&tab=text", { waitUntil: "domcontentloaded" });

    const results = page.getByTestId("search-results");
    await results.focus();
    await page.keyboard.press("ArrowDown");
    await expect(results.locator(".search-page-result.active")).toContainText("Diagnosis");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/wiki\/diagnostics\/diagnosis$/);
    await waitForPageTitle(page, "Diagnosis");
  });
});
