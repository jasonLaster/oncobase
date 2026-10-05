import { expect, test, type Page } from "@playwright/test";
import {
  documentArticle,
  firstSmartTableToggle,
  gotoWiki,
  installWikiApiMocks,
} from "../fixtures";

async function mockCommentsApi(page: Page) {
  await page.route("**/api/liveblocks-auth", (route) =>
    route.fulfill({
      // Exercise the signed-out UI without depending on a build-time public
      // key or opening a real Liveblocks room. Persistence is covered separately.
      status: route.request().method() === "GET" ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        siteSlug: "diana",
      }),
    }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: null }),
    }),
  );
  await page.route("**/api/liveblocks-guest", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    }),
  );
  await page.route("**/api/liveblocks-users", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ users: {} }),
    }),
  );
  await page.route("**/api/liveblocks-threads**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ threads: [], userNames: {} }),
    }),
  );
}

// Mocked tier: runs in the plain Playwright run. The local stack disables comments
// (no Liveblocks keys), so there the rail does not exist and these skip.
test.skip(
  process.env.VITE_ENABLE_COMMENTS === "false",
  "Comments are disabled by the local stack",
);

test.describe("comments (mocked Liveblocks)", () => {
  test("the outline rail exposes comments and opens the signed-out rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(documentArticle(page)).toContainText("Prior authorization");
    await page.getByRole("button", { name: "Open comments" }).click();
    const rail = page.locator("[data-wiki-shell-right-rail]").last();
    await expect(rail.getByText("Sign in to leave a comment")).toBeVisible({ timeout: 20_000 });

    await rail.getByRole("button", { name: "Outline" }).click();
    await expect(rail.getByRole("button", { name: "Insurance", exact: true })).toHaveClass(/active/);
  });

  test("signed-out mobile comments open account sign-in in place", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    // No bottom outline/comments rail on mobile; comments open from the header control.
    await expect(page.locator("[data-comments-bottom-rail]")).toHaveCount(0);
    await page.getByTestId("mobile-header-comments").click();
    const panel = page.locator("[data-comments-bottom-rail]");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toHaveAttribute("aria-label", "Document comments");
    await expect(panel).toContainText("0 unresolved threads");
    await expect(panel.getByText("Sign in to leave a comment")).toBeVisible();

    await panel.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    const dialog = page.getByRole("dialog", { name: "Sign in" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Email")).toBeVisible();
    await expect(dialog.getByLabel("Password")).toBeVisible();
    await expect(dialog).toContainText("Sign in to comment and view additional content.");
  });

  test("the global comments page shows its empty state and toggles open and all", async ({ page }) => {
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/");
    await page.getByTestId("sidebar-view-comments").click();
    await expect(page).toHaveURL(/\/comments$/);

    await expect(page.getByTestId("comments-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expect(page.getByText("No open comments")).toBeVisible();
    await page.getByRole("button", { name: "View all comments" }).click();
    await expect(page.getByRole("button", { name: "Open only" })).toBeVisible();
  });

  test("open comments keep an expanded table clear of the right rail", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/examples/smart-table");

    await firstSmartTableToggle(page).click();
    const layer = page.locator(".table-expansion-layer").first();
    await expect(layer).toBeVisible();
    const initialLayer = await layer.boundingBox();
    expect(initialLayer).not.toBeNull();

    await page.getByRole("button", { name: "Open comments" }).click();
    const rail = page.locator("[data-wiki-shell-right-rail]").last();
    await expect(rail.getByText("Sign in to leave a comment")).toBeVisible({ timeout: 20_000 });

    const [commentsLayer, commentsRail] = await Promise.all([layer.boundingBox(), rail.boundingBox()]);
    expect(commentsLayer).not.toBeNull();
    expect(commentsRail).not.toBeNull();
    expect(commentsRail!.x - (commentsLayer!.x + commentsLayer!.width)).toBeGreaterThanOrEqual(16);
    await expect
      .poll(async () => (await layer.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(initialLayer!.width);
  });
});
