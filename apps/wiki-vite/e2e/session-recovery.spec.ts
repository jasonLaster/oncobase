import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

const runsWithPreviewAuth = Boolean(
  process.env.PLAYWRIGHT_BASE_URL && process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD,
);

test.describe("Session scope recovery", () => {
  test("session identity failure can fall back to the public store", async ({ page }) => {
    await installWikiApiMocks(page);
    await page.goto("/wiki/logistics/insurance?scope=session&devtools=1#claims-follow-up", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("session-recovery")).toBeVisible();
    await expect(page.getByText("Session access needed")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open sign in" })).toHaveAttribute(
      "href",
      /\/login\?redirect=%2Fwiki%2Flogistics%2Finsurance%3Fscope%3Dsession%26devtools%3D1%23claims-follow-up$/,
    );

    await page.getByRole("button", { name: "Continue public" }).click();

    await expect(page).toHaveURL(/scope=public.*#claims-follow-up/);
    await waitForPageTitle(page, "Insurance");
    await expect(page.getByTestId("scope-switcher").getByText("Public")).toBeVisible();
  });

  test("header scope switcher preserves the current route", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/wiki/logistics/insurance?scope=session&devtools=1#claims-follow-up");

    const switcher = page.getByTestId("scope-switcher");
    await expect(switcher.getByText("Session")).toBeVisible();
    await expect(switcher.getByRole("link", { name: "Public" })).toHaveAttribute(
      "href",
      /\/wiki\/logistics\/insurance\?scope=public&devtools=1#claims-follow-up$/,
    );
  });

  test("login page matches the web password gate and preserves the redirect target", async ({ page }) => {
    test.skip(runsWithPreviewAuth, "Preview e2e starts authenticated to exercise protected wiki pages.");

    await installWikiApiMocks(page);
    await page.route("**/api/login", async (route) => {
      const body = route.request().postDataJSON() as { password?: string };
      if (body.password === "diana") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid password" }),
      });
    });
    await page.goto(
      "/login?redirect=%2Fwiki%2Flogistics%2Finsurance%3Fscope%3Dsession%23claims-follow-up",
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByRole("heading", { name: "TNBC Knowledge Base" })).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter" })).toBeVisible();
    await expect(page.getByTestId("app-header")).toHaveCount(0);
    await expect(page.getByTestId("wiki-sidebar")).toHaveCount(0);

    await page.getByPlaceholder("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByText("Incorrect password")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toHaveValue("");

    await page.getByPlaceholder("Password").fill("diana");
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page).toHaveURL(
      /\/wiki\/logistics\/insurance\?scope=session#claims-follow-up$/,
    );
  });

  test("public and session scopes use different stores and do not leak sensitive pages", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/private/plan?scope=session&devtools=1");
    await waitForPageTitle(page, "Private Plan");
    await expect(documentArticle(page)).toContainText("Sensitive session-only planning note");

    const sessionFooter = page.getByTestId("livestore-devtools-footer");
    await sessionFooter.locator("summary").click();
    const sessionStoreId = await sessionFooter.locator(".devtools-store").getAttribute("title");
    expect(sessionStoreId).toContain("session");

    await gotoWiki(page, "/private/plan?scope=public&devtools=1");
    await expect(documentArticle(page).locator("h1")).toHaveText("Page not found");
    await expect(documentArticle(page)).not.toContainText("Sensitive session-only planning note");
    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette-input").fill("private plan");
    await expect(page.getByText("No pages found")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();

    const publicFooter = page.getByTestId("livestore-devtools-footer");
    await publicFooter.locator("summary").click();
    const publicStoreId = await publicFooter.locator(".devtools-store").getAttribute("title");
    expect(publicStoreId).toContain("public");
    expect(publicStoreId).not.toBe(sessionStoreId);
  });

  test("session cache-key changes open a separate authenticated store", async ({ page }) => {
    const requests = await installWikiApiMocks(page, {
      sessionAuthenticated: true,
      sessionCacheKey: "diana:session:e2e-user:first",
    });
    await gotoWiki(page, "/private/plan?scope=session&devtools=1");
    await waitForPageTitle(page, "Private Plan");

    const firstFooter = page.getByTestId("livestore-devtools-footer");
    await firstFooter.locator("summary").click();
    const firstStoreId = await firstFooter.locator(".devtools-store").getAttribute("title");
    expect(firstStoreId).toContain("session");

    requests.setSessionCacheKey("diana:session:e2e-user:rotated");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForPageTitle(page, "Private Plan");

    const secondFooter = page.getByTestId("livestore-devtools-footer");
    await secondFooter.locator("summary").click();
    const secondStoreId = await secondFooter.locator(".devtools-store").getAttribute("title");
    expect(secondStoreId).toContain("session");
    expect(secondStoreId).not.toBe(firstStoreId);
  });
});
