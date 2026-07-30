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
    await expect(page).toHaveTitle("Insurance — TNBC Knowledge Base");
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
    await expect(page.getByTestId("mobile-page-outline")).toHaveCount(0);
    await page.getByTestId("bottom-nav-trigger").click();
    await page.getByRole("button", { name: "Outline" }).click();
    const mobileOutline = page.getByTestId("bottom-nav-outline");
    await expect(mobileOutline.getByRole("button", { name: "Claims follow-up" })).toBeVisible();
    await mobileOutline.getByRole("button", { name: "Claims follow-up" }).click();

    await expect(page).toHaveURL(/#claims-follow-up$/);
  });

  test("tracks the active mobile outline heading while the document scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");

    await page.getByTestId("bottom-nav-trigger").click();
    await page.getByRole("button", { name: "Outline" }).click();
    await page.getByRole("button", { name: "Close navigation" }).click();
    await page.locator("#saturday-april-12").evaluate((heading) => heading.scrollIntoView());
    await page
      .locator(".content-shell")
      .evaluate((scroller) => scroller.scrollBy(0, -Math.round(window.innerHeight * 0.25)));
    await page.getByTestId("bottom-nav-trigger").click();
    await page.getByRole("button", { name: "Outline" }).click();
    const mobileOutline = page.getByTestId("bottom-nav-outline");
    const saturdayHeading = mobileOutline.getByRole("button", {
      name: "Saturday, April 12",
    });
    await expect(saturdayHeading).toHaveAttribute("aria-current", "location");
    await expect(saturdayHeading).toHaveAttribute("data-active-outline-heading", "true");

    await page.getByRole("button", { name: "Close navigation" }).click();
    await page.locator("#treatment-note").evaluate((heading) => heading.scrollIntoView());
    await page
      .locator(".content-shell")
      .evaluate((scroller) => scroller.scrollBy(0, -Math.round(window.innerHeight * 0.25)));
    await page.getByTestId("bottom-nav-trigger").click();
    await page.getByRole("button", { name: "Outline" }).click();
    const treatmentHeading = page
      .getByTestId("bottom-nav-outline")
      .getByRole("button", { name: "Treatment note" });
    await expect(treatmentHeading).toHaveAttribute("aria-current", "location");
    await expect(
      page
        .getByTestId("bottom-nav-outline")
        .getByRole("button", { name: "Saturday, April 12" }),
    ).not.toHaveAttribute("aria-current", "location");
  });

  test("shows the mobile comments action only on document routes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const pathname of [
      "/",
      "/wiki/logistics/insurance",
      "/about/About",
      "/sources/people/providers/stanford/telli",
    ]) {
      await gotoWiki(page, pathname);
      await expect(page.getByTestId("mobile-header-comments")).toBeVisible();
    }

    for (const pathname of [
      "/comments",
      "/admin",
      "/tags/logistics",
      "/search",
      "/timeline",
      "/diagnostics",
      "/tools/medical-deduction",
    ]) {
      await page.goto(pathname);
      await expect(page.getByTestId("mobile-page-header")).toBeVisible();
      await expect(page.getByTestId("mobile-header-comments")).toHaveCount(0);
    }
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
