import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("Page chrome parity", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("renders breadcrumbs, description, and page action affordances", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.getByTestId("breadcrumbs")).toContainText("Home/wiki/logistics/insurance");
    await expect(documentArticle(page).locator(".page-header")).toContainText(
      "Insurance planning notes.",
    );

    const actions = page.getByTestId("page-actions");
    await expect(actions.getByRole("button", { name: "Copy page as markdown" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Copy page link" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Print page" })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Markdown" })).toHaveAttribute(
      "href",
      /\/api\/page-copy\?slug=wiki%2Flogistics%2Finsurance/,
    );
    await expect(actions.getByRole("link", { name: "Main app" })).toHaveAttribute(
      "href",
      /\/wiki\/logistics\/insurance$/,
    );
  });

  test("copies local markdown without a server body fetch", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("button", { name: "Copy page as markdown" }).click();

    await expect(page.getByRole("button", { name: "Copy page as markdown" })).toContainText(
      "Copied",
    );
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
      "Prior authorization",
    );
  });

  test("renders a persistent outline rail for page headings", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const outline = page.getByTestId("page-outline");
    await expect(outline.getByRole("button", { name: "Prior authorization" })).toBeVisible();
    await outline.getByRole("button", { name: "Claims follow-up" }).click();

    await expect(page).toHaveURL(/#claims-follow-up$/);
  });
});
