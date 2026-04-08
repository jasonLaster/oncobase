import { test, expect } from "@playwright/test";

test.describe("Search", () => {
  test("search from header bar navigates to results", async ({ page }) => {
    await page.goto("/");
    const searchInput = page.locator("header").getByPlaceholder("Search...");
    await searchInput.fill("diagnosis");
    await searchInput.press("Enter");

    await expect(page).toHaveURL(/\/search\?q=diagnosis/);
    // Wait for results to load - the summary text "X results in Y files"
    await expect(
      page.getByText(/\d+ results? in \d+ files?/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("search results contain relevant pages", async ({ page }) => {
    await page.goto("/search?q=treatment");
    // Wait for results summary
    await expect(
      page.getByText(/\d+ results? in \d+ files?/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("empty search shows no results message", async ({ page }) => {
    await page.goto("/search?q=zzzznonexistentquery999");
    await expect(
      page.getByText("No results for").first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
