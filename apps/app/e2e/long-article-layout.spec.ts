import { expect, test } from "@playwright/test";
import { documentArticle, firstSmartTableToggle, gotoWiki, installWikiApiMocks } from "./fixtures";

test("long interactive articles retain late anchors, table expansion, and complete print layout", async ({ page }) => {
  await installWikiApiMocks(page, { pageOverrides: { "wiki/examples/smart-table": {
    content: "[Jump to last section](#last-section)\n\n" +
      ("A complete paragraph. " + "Readable article content. ".repeat(16) + "\n\n").repeat(600) +
      "## Last section\n\nThe complete final paragraph.\n\n" +
      "| First | Second | Third |\n| --- | --- | --- |\n| Complete value | Another value | Final value |",
  } } });
  await gotoWiki(page, "/wiki/examples/smart-table");
  const article = documentArticle(page);
  const heading = article.locator("#last-section");
  await expect(heading).toHaveCSS("content-visibility", "auto");
  await article.getByRole("link", { name: "Jump to last section", exact: true }).click();
  await expect(heading).toBeInViewport();
  await expect(article.getByText("The complete final paragraph.", { exact: true })).toBeInViewport();
  const table = article.locator("table");
  await table.scrollIntoViewIfNeeded();
  await expect(table).toHaveAttribute("data-smart-table-widths", /\d/);
  await firstSmartTableToggle(page).click();
  await expect(page.locator(".table-expansion-layer")).toBeVisible();
  await page.getByRole("button", { name: "Collapse table" }).click();
  await expect(page.locator(".table-expansion-layer")).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(heading).toHaveCSS("content-visibility", "visible");
  await expect(article.locator(".wiki-markdown p")).toHaveCount(602);
});
