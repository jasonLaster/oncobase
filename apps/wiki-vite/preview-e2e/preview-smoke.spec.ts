import { expect, test } from "@playwright/test";

const smokePath = process.env.WIKI_VITE_SMOKE_PATH ?? "/wiki/logistics/insurance";

test("preview loads a public wiki page from the configured backend", async ({ page }) => {
  await page.goto(smokePath, { waitUntil: "domcontentloaded" });

  const article = page.getByTestId("document-article").first();
  await expect(page).toHaveTitle(/Insurance|Diana Wiki/i);
  await expect(page.getByTestId("app-header")).toBeVisible();
  await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
  await expect(article).toBeVisible();
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  await expect(article.locator("h1")).toBeVisible();
  await expect(page.locator(".metrics-panel")).toContainText("manifest");
  await expect(page.locator(".vite-error-overlay")).toHaveCount(0);
});
