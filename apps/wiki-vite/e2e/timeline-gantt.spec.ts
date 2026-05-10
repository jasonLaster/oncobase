import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("timeline gantt rendering", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("renders the timeline gantt mermaid diagram", async ({ page }) => {
    await gotoWiki(page, "/wiki/timeline/gantt");

    const diagram = documentArticle(page).getByTestId("mermaid-diagram");
    await expect(diagram).toBeVisible();
    await expect(diagram).toContainText("Care Timeline");
    await expect(diagram).toContainText("Chemo");
    await expect(diagram.locator("code")).toContainText("gantt");
  });
});
