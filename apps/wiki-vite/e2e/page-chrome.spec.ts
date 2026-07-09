import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("Page chrome parity", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("renders the web-parity document header chrome", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.getByTestId("breadcrumbs")).toHaveCount(0);
    await expect(documentArticle(page).locator(".page-header h1")).toHaveText("Insurance");
    await expect(documentArticle(page).locator(".page-header")).not.toContainText(
      "Insurance planning notes.",
    );
    await expect(documentArticle(page).locator(".page-header")).not.toContainText("KB");
    await expect(page).toHaveTitle("Insurance - Diana Wiki");
    await expect
      .poll(() =>
        page.locator('meta[name="description"]').getAttribute("content"),
      )
      .toBe("Insurance planning notes.");

    const actions = page.getByTestId("page-actions");
    await expect(actions.getByRole("button", { name: "Copy page as markdown" })).toBeVisible();
    await expect(actions.getByRole("button")).toHaveCount(1);
    await expect(actions.getByRole("link")).toHaveCount(0);
  });

  test("page markdown copy payloads are served by the Vite API boundary", async ({ page, request }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const response = await request.get(
      "/api/page-copy?slug=wiki%2Flogistics%2Finsurance&cacheKey=latest&scope=public",
    );
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/markdown");
    expect(response.headers()["x-wiki-cache-scope"]).toBe("public");
    expect((await response.text()).length).toBeGreaterThan(100);
  });

  test("copies local markdown without a server body fetch", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("button", { name: "Copy page as markdown" }).click();

    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
      "Prior authorization",
    );
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

  test("surfaces source file provenance from the local asset index", async ({ page }) => {
    await gotoWiki(page, "/sources/people/providers/stanford/telli");

    const sources = page.getByTestId("source-links");
    await expect(sources).toContainText("Source files");
    await expect(
      sources.getByRole("link", { name: /telli-2016-hrd-platinum-tnbc\.pdf/ }),
    ).toHaveAttribute(
      "href",
      /\/api\/file\?path=sources%2Fpeople%2Fproviders%2Fstanford%2Ftelli%2Ftelli-2016-hrd-platinum-tnbc\.pdf/,
    );
  });
});
