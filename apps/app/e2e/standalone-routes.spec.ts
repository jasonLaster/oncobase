import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

for (const route of [
  { path: "/login", testId: "login-page" },
  { path: "/terms-and-conditions", testId: "terms-and-conditions" },
]) {
  test(`${route.path} does not require the reader session or database`, async ({ page, context }) => {
    // A valid password-gate cookie intentionally redirects /login to the wiki.
    await context.clearCookies();
    // An expired reader session must not block sign-in or public terms.
    await page.addInitScript(() => localStorage.setItem("wiki-vite-scope", "session"));
    const readerRequests: string[] = [];
    await page.route("**/api/wiki/**", async (request) => {
      readerRequests.push(new URL(request.request().url()).pathname);
      await request.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    const databaseModules: string[] = [];
    page.on("request", (request) => {
      if (/LiveStoreRoot/.test(request.url())) databaseModules.push("LiveStoreRoot");
    });

    await page.goto(route.path);
    await expect(page.getByTestId(route.testId)).toBeVisible();
    await expect(page.getByTestId("session-recovery")).toHaveCount(0);
    await expect(page.getByTestId("wiki-sidebar")).toHaveCount(0);
    expect(readerRequests).toEqual([]);
    expect(databaseModules).toEqual([]);
  });
}

test("client navigation and history cross reader and standalone routes", async ({ page }) => {
  await installWikiApiMocks(page, {
    pageOverrides: {
      index: { content: "# Diana Wiki Home\n\n[Read terms](/terms-and-conditions)" },
    },
  });
  await gotoWiki(page, "/");
  await page.evaluate(() => { document.documentElement.dataset.qaNavigation = "same-document"; });
  await documentArticle(page).getByRole("link", { name: "Read terms" }).click();
  await expect(page.getByTestId("terms-and-conditions")).toBeVisible();
  await expect(page.getByTestId("wiki-sidebar")).toHaveCount(0);
  await page.getByRole("link", { name: "Diana TNBC Knowledge Base" }).click();
  await expect(documentArticle(page)).toContainText("Read terms");
  await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("terms-and-conditions")).toBeVisible();
  await page.goForward();
  await expect(documentArticle(page)).toContainText("Read terms");
  await expect(page.locator("html")).toHaveAttribute("data-qa-navigation", "same-document");
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 393, height: 852 }]) {
  test(`public terms preserve document typography at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/terms-and-conditions");
    const article = page.getByTestId("terms-and-conditions");
    const title = article.getByRole("heading", { name: "Terms and Conditions", exact: true });
    const section = article.getByRole("heading", { name: "1. Informational and educational use only", exact: true });
    await expect(title).toHaveCSS("font-size", "30px");
    await expect(title).toHaveCSS("line-height", "36px");
    await expect(section).toHaveCSS("font-size", "24px");
    // WebKit serializes this as 27.200001px; compare the numeric layout value.
    expect(await article.locator("p").nth(1).evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).lineHeight),
    )).toBeCloseTo(27.2, 3);
    await expect(article.locator("ul")).toHaveCSS("list-style-type", "disc");
    const titleBox = await title.boundingBox();
    const dateBox = await article.locator("p").first().boundingBox();
    expect(dateBox!.y - (titleBox!.y + titleBox!.height)).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
