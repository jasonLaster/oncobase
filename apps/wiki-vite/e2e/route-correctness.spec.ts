import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  waitForPageTitle,
} from "./fixtures";

test.describe("Route-owned metadata and links", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("tag navigation replaces the previous article title", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    await documentArticle(page)
      .locator(".tag-row")
      .getByRole("link", { name: "logistics" })
      .click();

    await expect(page).toHaveURL(/\/tags\/logistics$/);
    await expect(page).toHaveTitle("Tag: logistics — TNBC Knowledge Base");
  });

  test("home and search routes use production titles", async ({ page }) => {
    await gotoWiki(page, "/");
    await expect(page).toHaveTitle("Home — TNBC Knowledge Base");

    await page.goto("/search");
    await expect(page).toHaveTitle("Search — TNBC Knowledge Base");
    await expect(page.getByRole("textbox", { name: "Search the wiki" })).toHaveAttribute(
      "placeholder",
      "Search the wiki…",
    );
  });

  test("bracketed redacted labels preserve mail and telephone protocol links", async ({
    page,
  }) => {
    await gotoWiki(page, "/about/About");

    const mailLink = documentArticle(page).getByRole("link", {
      name: /redacted email/,
    });
    const phoneLink = documentArticle(page).getByRole("link", {
      name: /redacted phone/,
    });
    await expect(mailLink).toHaveAttribute("href", "mailto:diana@example.com");
    await expect(phoneLink).toHaveAttribute("href", "tel:+14155550123");
    await expect(documentArticle(page).locator('a[href="/redacted%20email"]')).toHaveCount(0);
  });
});
