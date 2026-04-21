import { expect, test } from "@playwright/test";

const TIMELINE_ROUTE =
  "/sources/resources/0420-phm-mopro-wishlist-analysis#timeline-gantt";

test.describe("timeline gantt rendering", () => {
  test("renders the timeline gantt mermaid diagram", async ({ page }) => {
    await page.goto(TIMELINE_ROUTE, { waitUntil: "networkidle" });

    await expect(page.locator("article h3#timeline-gantt")).toHaveText(
      "Timeline (gantt)"
    );

    await expect(page.locator("article .mermaid-placeholder")).toHaveCount(0);
    await expect(page.locator("article .mermaid-error")).toHaveCount(0);

    const ganttSvg = page.locator("article .mermaid-diagram svg").first();
    await expect(ganttSvg).toBeVisible();
    await expect(ganttSvg).toContainText(
      "MoPro wishlist timeline — critical path in red, parallel in blue"
    );
  });
});
