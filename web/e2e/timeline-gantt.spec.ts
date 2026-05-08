import { expect, test } from "@playwright/test";

const TIMELINE_ROUTE = "/sources/resources/04-20-phm-mopro-wishlist-analysis";

test.describe("timeline gantt rendering", () => {
  test("renders the timeline gantt mermaid diagram", async ({ page }) => {
    await page.goto(TIMELINE_ROUTE, { waitUntil: "domcontentloaded" });

    const article = page.getByTestId("document-article").first();
    await expect(article).toBeVisible();

    await expect(article.locator(".mermaid-placeholder")).toHaveCount(0, {
      timeout: 25_000,
    });
    await expect(article.locator(".mermaid-error")).toHaveCount(0);

    const ganttSvg = article
      .locator(".mermaid-diagram svg")
      .filter({
        hasText:
          "MoPro wishlist timeline — critical path in red, parallel in blue",
      });
    await expect(ganttSvg).toBeVisible();
  });
});
