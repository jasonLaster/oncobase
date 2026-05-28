import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("timeline gantt rendering", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("upgrades the gantt fallback into a rendered SVG", async ({ page }) => {
    await gotoWiki(page, "/wiki/timeline/gantt");

    const article = documentArticle(page);
    const diagram = article.getByTestId("mermaid-diagram");
    await expect(diagram).toBeVisible();
    await expect(diagram).toHaveAttribute("data-graph", /.+/);

    // `WikiMermaidRenderer` is lazy-loaded by `WikiPage.MermaidRendererSlot`
    // only when the markdown contains a mermaid fence, then replaces the
    // fallback body with the rendered SVG.
    await expect(diagram.locator("svg")).toBeVisible({ timeout: 25_000 });
    await expect(article.locator(".mermaid-error")).toHaveCount(0);
    await expect(diagram).toContainText("Care Timeline");
    await expect(diagram).toContainText("Chemo");
  });
});
