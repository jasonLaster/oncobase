import { expect, test, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

async function mockCommentsApi(page: Page) {
  await page.route("**/api/liveblocks-auth", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: false,
        reason: "credentials-missing",
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

test.describe("document comments sidebar", () => {
  test("outline rail exposes comments activation on document pages", async ({ page }) => {
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(documentArticle(page)).toContainText("Prior authorization");
    await expect(page.getByRole("button", { name: "Open comments" })).toBeVisible();
  });

  test("mobile comments activate from the mobile header control", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    // Web parity: no bottom outline/comments rail on mobile; comments open
    // from the mobile header control instead.
    await expect(page.locator("[data-comments-bottom-rail]")).toHaveCount(0);
    await page.evaluate(() => {
      const win = window as typeof window & { __mobileCommentsRequested?: string | null };
      window.addEventListener(
        "mobile-comments-panel-open",
        () => {
          win.__mobileCommentsRequested =
            document.documentElement.dataset.mobileCommentsPanelRequested ?? null;
        },
        { once: true },
      );
    });
    const trigger = page.getByTestId("mobile-header-comments");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const win = window as typeof window & { __mobileCommentsRequested?: string | null };
          return win.__mobileCommentsRequested;
        }),
      )
      .toBe("true");
    const panel = page.locator("[data-comments-bottom-rail]");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText("unresolved threads");
  });
});

test.describe("global comments page", () => {
  test("loads and shows an empty comments state", async ({ page }) => {
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await page.goto("/comments", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("comments-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expect(page.getByText("No open comments")).toBeVisible();
  });

  test("toggle between open and all comments", async ({ page }) => {
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await page.goto("/comments", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "View all comments" }).click();
    await expect(page.getByRole("button", { name: "Open only" })).toBeVisible();
  });
});

test.describe("comments and Liveblocks API endpoints", () => {
  test("liveblocks-auth GET returns configured status", async ({ request }) => {
    const response = await request.get("/api/liveblocks-auth");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        configured: expect.any(Boolean),
        siteSlug: expect.any(String),
      }),
    );
  });

  test("liveblocks-users rejects malformed IDs", async ({ request }) => {
    const response = await request.post("/api/liveblocks-users", {
      data: { userIds: ["guest_test", 123] },
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "userIds must only contain strings",
    });
  });

  test("delete-thread API rejects missing params", async ({ request }) => {
    const response = await request.post("/api/liveblocks-delete-thread", {
      data: {},
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "roomId and threadId are required",
    });
  });
});

test.describe("comments sidebar navigation", () => {
  test("View comments link is visible in sidebar", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await expect(page.getByTestId("sidebar-view-comments")).toBeVisible();
  });

  test("clicking View comments navigates to /comments", async ({ page }) => {
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/");

    await page.getByTestId("sidebar-view-comments").click();
    await expect(page).toHaveURL(/\/comments$/);
    await expect(page.getByTestId("comments-page")).toBeVisible();
  });
});
