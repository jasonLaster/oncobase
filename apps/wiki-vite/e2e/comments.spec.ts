import { expect, test, type Page } from "@playwright/test";
import {
  documentArticle,
  firstSmartTableToggle,
  gotoWiki,
  installWikiApiMocks,
} from "./fixtures";
import { passwordGateCookie } from "./gate-auth";

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
    await expect(panel).toHaveAttribute("aria-label", "Document comments");
    await expect(panel).toContainText("0 unresolved threads");
    await expect(panel.getByText("Sign in to leave a comment")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Sign in" })).toBeVisible();
    const closeButton = page.getByRole("button", {
      name: "Close comments panel",
      exact: true,
    });
    await expect(closeButton).toBeVisible();

    const geometry = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        radius: style.borderTopLeftRadius,
        width: Math.round(rect.width),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
      };
    });
    expect(geometry).toEqual({
      bottom: 844,
      height: 743,
      radius: "18px",
      width: 390,
      x: 0,
      y: 101,
    });

    await closeButton.click();
    await expect(panel).toHaveCount(0);
  });

  test("signed-out mobile comments open account sign-in in place", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByTestId("mobile-header-comments").click();
    const signIn = page
      .locator("[data-comments-bottom-rail]")
      .getByRole("button", { name: "Sign in" });
    await expect(signIn).toBeVisible({ timeout: 20_000 });
    await signIn.click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    const dialog = page.getByRole("dialog", { name: "Sign in" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Email")).toBeVisible();
    await expect(dialog.getByLabel("Password")).toBeVisible();
    await expect(dialog).toContainText(
      "Sign in to comment and view additional content.",
    );
  });

  test("expanded desktop comments keep the production rail surface", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("button", { name: "Open comments" }).click();
    const rail = page.locator("[data-wiki-shell-right-rail]").last();
    await expect(rail.getByText("Sign in to leave a comment")).toBeVisible({
      timeout: 20_000,
    });
    await expect(rail).toHaveCSS("background-color", "rgb(255, 255, 255)");
    expect(await rail.evaluate((element) => getComputedStyle(element).boxShadow)).toContain(
      "rgba(0, 0, 0, 0.12) -4px 0px 12px 0px",
    );
    const box = await rail.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBe(0);
    expect(box!.height).toBe(720);

    await rail.getByRole("button", { name: "Outline" }).click();
    const firstHeading = rail.getByRole("button", { name: "Insurance", exact: true });
    await expect(firstHeading).toHaveClass(/active/);
    await expect(firstHeading).toHaveCSS("font-size", "16px");
    await expect(firstHeading).toHaveCSS("min-height", "40px");
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
    await expect(rail.getByText("Sign in to leave a comment")).toBeVisible({
      timeout: 20_000,
    });

    const [commentsLayer, commentsRail] = await Promise.all([
      layer.boundingBox(),
      rail.boundingBox(),
    ]);
    expect(commentsLayer).not.toBeNull();
    expect(commentsRail).not.toBeNull();
    expect(commentsRail!.x - (commentsLayer!.x + commentsLayer!.width)).toBeGreaterThanOrEqual(
      16,
    );

    await expect
      .poll(async () => (await layer.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(initialLayer!.width);
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
    const cookie = await passwordGateCookie(request);
    const response = await request.get("/api/liveblocks-auth", {
      headers: { Cookie: cookie },
    });
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
    const cookie = await passwordGateCookie(request);
    const response = await request.post("/api/liveblocks-users", {
      data: { userIds: ["guest_test", 123] },
      headers: { Cookie: cookie },
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "userIds must only contain strings",
    });
  });

  test("delete-thread API rejects missing params", async ({ request }) => {
    const cookie = await passwordGateCookie(request);
    const response = await request.post("/api/liveblocks-delete-thread", {
      data: {},
      headers: { Cookie: cookie },
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
