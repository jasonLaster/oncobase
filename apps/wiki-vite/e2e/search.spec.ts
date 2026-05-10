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

  test.skip("AI mode shows ranked results", async () => {
    // AI search remains a backend/full-stack feature for v1.
  });

  test.skip("AI mode results link to wiki pages", async () => {
    // AI search remains a backend/full-stack feature for v1.
  });

  test.skip("AI mode shows error states", async () => {
    // AI search remains a backend/full-stack feature for v1.
  });
});
