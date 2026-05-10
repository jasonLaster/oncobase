import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

test.describe("Local page finder", () => {
  test("finder from the header navigates to a cached page", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await page.getByTestId("header-search-input").fill("diagnosis");
    await page.getByRole("link", { name: /Diagnosis/ }).click();

    await expect(page).toHaveURL(/\/wiki\/diagnostics\/diagnosis$/);
    await waitForPageTitle(page, "Diagnosis");
  });

  test("empty local finder shows no results message", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await page.getByTestId("header-search-input").fill("zzzznonexistentquery999");

    await expect(page.getByText("No local matches")).toBeVisible();
    await expect(page.getByRole("link", { name: "Search backend" })).toHaveAttribute(
      "href",
      /\/search\?q=zzzznonexistentquery999&returnTo=%2F$/,
    );
  });

  test("public finder does not include sensitive pages", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/");

    await page.getByTestId("header-search-input").fill("private plan");

    await expect(page.getByText("No local matches")).toBeVisible();
  });

  test("session finder can include sensitive pages in its separate store", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/?scope=session");

    await page.getByTestId("header-search-input").fill("private plan");
    await page.getByRole("link", { name: /Private Plan/ }).click();

    await expect(page).toHaveURL(/\/private\/plan$/);
    await waitForPageTitle(page, "Private Plan");
    await expect(page.locator(".badge.sensitive")).toHaveText("sensitive");
  });

  test("header exposes backend search and chat handoffs", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.getByRole("link", { name: "Search" })).toHaveAttribute(
      "href",
      /\/search\?returnTo=%2Fwiki%2Flogistics%2Finsurance$/,
    );
    await expect(page.getByRole("link", { name: "New Chat" })).toHaveAttribute(
      "href",
      /\/chat\?returnTo=%2Fwiki%2Flogistics%2Finsurance$/,
    );
  });

  test("search route runs backend text search and opens results", async ({ page }) => {
    await page.route("**/api/search?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/logistics/insurance",
              title: "Insurance",
              excerpt: "Prior authorization and coverage notes.",
              tags: ["logistics"],
            },
          ],
        }),
      }),
    );
    await installWikiApiMocks(page);
    await page.goto("/search?q=insurance&returnTo=%2Fwiki%2Flogistics%2Finsurance", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("search-page")).toBeVisible();
    await expect(page.getByTestId("search-results")).toContainText("1 result");
    await page.getByRole("link", { name: /Insurance/ }).click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await waitForPageTitle(page, "Insurance");
  });

  test("AI mode shows ranked results", async ({ page }) => {
    await page.route("**/api/search?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/logistics/insurance",
              title: "Insurance",
              excerpt: "Prior authorization and coverage notes.",
              tags: ["logistics"],
            },
          ],
        }),
      }),
    );
    await page.route("**/api/ai-search", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/logistics/insurance",
              title: "Insurance",
              relevance: 8.5,
              summary: "Insurance is relevant because it covers payer authorization.",
              tags: ["logistics"],
            },
          ],
        }),
      }),
    );
    await installWikiApiMocks(page);
    await page.goto("/search?q=authorization&mode=ai", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("button", { name: "AI" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("search-results")).toContainText("8.5 relevance");
    await expect(page.getByTestId("search-results")).toContainText("payer authorization");
    await expect(page.getByTestId("search-results")).toContainText("logistics");
    await expect
      .poll(() =>
        page.evaluate(() => window.__WIKI_VITE_OBSERVABILITY__?.search.at(-1)?.mode),
      )
      .toBe("ai");
  });

  test("search results support keyboard selection", async ({ page }) => {
    await page.route("**/api/search?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
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
        }),
      }),
    );
    await installWikiApiMocks(page);
    await page.goto("/search?q=care", { waitUntil: "domcontentloaded" });

    const results = page.getByTestId("search-results");
    await results.focus();
    await page.keyboard.press("ArrowDown");
    await expect(results.locator(".search-page-result.active")).toContainText("Diagnosis");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/wiki\/diagnostics\/diagnosis$/);
    await waitForPageTitle(page, "Diagnosis");
  });

  test("AI mode results link to wiki pages", async ({ page }) => {
    await page.route("**/api/search?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ results: [] }),
      }),
    );
    await page.route("**/api/ai-search", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/diagnostics/diagnosis",
              title: "Diagnosis",
              relevance: 9,
              summary: "Diagnosis context matches the query.",
              tags: ["diagnostics"],
            },
          ],
        }),
      }),
    );
    await installWikiApiMocks(page);
    await page.goto("/search?q=diagnosis&mode=ai", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /Diagnosis/ }).click();

    await expect(page).toHaveURL(/\/wiki\/diagnostics\/diagnosis$/);
    await waitForPageTitle(page, "Diagnosis");
  });

  test("AI mode shows error states", async ({ page }) => {
    await page.route("**/api/search?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/logistics/insurance",
              title: "Insurance",
              excerpt: "Prior authorization and coverage notes.",
              tags: ["logistics"],
            },
          ],
        }),
      }),
    );
    await page.route("**/api/ai-search", (route) =>
      route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({ results: [], error: "AI search quota or authorization failed." }),
      }),
    );
    await installWikiApiMocks(page);
    await page.goto("/search?q=authorization&mode=ai", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("AI search quota or authorization failed.")).toBeVisible();
    await expect(page.getByTestId("search-results")).toContainText("Insurance");
  });
});
