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

  test("mobile bottom rail exposes comments activation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.locator("[data-comments-bottom-rail]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Comments" })).toBeVisible();
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

test.describe("Liveblocks credential-required comment creation", () => {
  test.beforeEach(() => {
    test.skip(
      true,
      "Requires live Liveblocks workspace credentials and signed-in comment permissions.",
    );
  });

  test("page-level composer opens and has send button", async () => {});
  test("typing in composer enables send button", async () => {});
  test("sidebar loads with Comments / Outline toggle", async () => {});
  test("sidebar shows thread count", async () => {});
  test("switching to Outline tab shows headings", async () => {});
  test("comment and outline rail buttons toggle the rail", async () => {});
  test("comments rail can be resized", async () => {});
  test("comment actions menu opens with filter option", async () => {});
  test("toggling resolved filter changes thread count label", async () => {});
  test("per-comment actions dropdown opens above the rail", async () => {});
  test("reaction emoji picker opens above the rail", async () => {});
  test("highlight overlay does not block text selection", async () => {});
  test("pending highlight renders behind article text", async () => {});
  test("draft selection thread renders in sorted list order", async () => {});
  test("opening a linked selection URL activates the thread", async () => {});
  test("liveblocks-threads GET returns threads array from Liveblocks", async () => {});
  test("guest names are stored in Convex and resolvable to other users", async () => {});
  test("signed-in user names resolve from Convex user records", async () => {});
  test("delete thread menu item appears on first comment", async () => {});
  test("delete thread action keeps the comments rail open", async () => {});
});
