import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

// The Vite reader renders the same minimal chrome as the legacy Next.js reader:
// a title row (h1 + copy-as-markdown action), a tag row, and the persistent
// outline rail. Breadcrumbs, the inline download action row, the size badge,
// and the source-links section were removed so both readers are identical.
test.describe("Page chrome parity", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("renders the minimal reader header with title, copy action, and tags", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const header = documentArticle(page).locator(".page-header");
    await expect(header.locator("h1")).toHaveText("Insurance");
    await expect(
      header.getByRole("button", { name: "Copy page as markdown" }),
    ).toBeVisible();

    await expect(
      documentArticle(page).locator(".tag-row").getByRole("link", { name: "logistics" }),
    ).toBeVisible();

    await expect(page).toHaveTitle("Insurance - Diana Wiki");
    await expect
      .poll(() => page.locator('meta[name="description"]').getAttribute("content"))
      .toBe("Insurance planning notes.");
  });

  test("copies local markdown via the shared copy-as-markdown action", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("button", { name: "Copy page as markdown" }).click();

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("Prior authorization");
  });

  test("renders a persistent outline rail for page headings", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const outline = page.getByTestId("page-outline");
    await expect(outline).toHaveAttribute("data-outline-state", "collapsed");
    await outline.getByRole("button", { name: "Open outline" }).click();
    await expect(outline).toHaveAttribute("data-outline-state", "expanded");
    await expect(outline.getByRole("button", { name: "Prior authorization" })).toBeVisible();
    await outline.getByRole("button", { name: "Claims follow-up" }).click();

    await expect(page).toHaveURL(/#claims-follow-up$/);
  });

  test("renders a mobile outline control for page headings", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.getByTestId("page-outline")).toBeHidden();
    const mobileOutline = page.getByTestId("mobile-page-outline");
    await expect(mobileOutline).toContainText("3 headings");
    await mobileOutline.getByRole("button", { name: "Expand outline rail" }).click();
    await mobileOutline.getByRole("button", { name: "Claims follow-up" }).click();

    await expect(page).toHaveURL(/#claims-follow-up$/);
  });
});
