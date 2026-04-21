import { expect, test } from "@playwright/test";

const TIMELINE_ROUTE =
  "/sources/resources/0420-phm-mopro-wishlist-analysis#timeline-gantt";

test.describe("timeline gantt rendering", () => {
  test("renders the timeline gantt mermaid diagram", async ({ page }) => {
    await page.goto(TIMELINE_ROUTE, { waitUntil: "networkidle" });

    const article = page.locator("article:visible").first();
    await expect(article.locator("h3#timeline-gantt")).toContainText(
      "Timeline (gantt)"
    );

    await expect(article.locator(".mermaid-placeholder")).toHaveCount(0);
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
