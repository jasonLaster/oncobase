import { expect, test, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";
import { passwordGateCookie } from "./gate-auth";

async function mockCommentsApi(
  page: Page,
  threads: Array<Record<string, unknown>> = [],
  sessionUser: { email: string; name: string } | null = null,
) {
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
      body: JSON.stringify({ user: sessionUser }),
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
      body: JSON.stringify({ threads, userNames: { user_1: "Parity Reader" } }),
    }),
  );
}

function commentThread({
  anchored,
  id,
  text,
}: {
  anchored: boolean;
  id: string;
  text: string;
}) {
  const timestamp = "2026-08-01T12:00:00.000Z";
  return {
    id,
    roomId: "markdown:wiki/logistics/insurance",
    createdAt: timestamp,
    updatedAt: timestamp,
    resolved: false,
    metadata: {
      documentSlug: "wiki/logistics/insurance",
      documentTitle: "Insurance",
      ...(anchored
        ? {
            anchorStart: 10,
            anchorEnd: 30,
            anchorQuote: "Prior authorization",
          }
        : {}),
    },
    comments: [
      {
        id: `${id}-comment`,
        userId: "user_1",
        createdAt: timestamp,
        body: {
          version: 1,
          content: [{ type: "paragraph", children: [{ text }] }],
        },
      },
    ],
  };
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
    const panel = page.getByTestId("mobile-comments-panel");
    await expect(panel).toHaveAttribute("data-state", "open", { timeout: 20_000 });
    const commentsRail = panel.getByRole("complementary", {
      name: "Document comments",
    });
    await expect(commentsRail).toBeVisible();
    await expect(commentsRail).toContainText("0 unresolved threads");
    await expect(commentsRail.getByText("Sign in to leave a comment")).toBeVisible();
    await expect(commentsRail.getByRole("button", { name: "Sign in" })).toBeVisible();
    const closeButton = page.getByRole("button", {
      name: "Close comments panel",
      exact: true,
    });
    await expect(closeButton).toBeVisible();

    await expect
      .poll(async () =>
        commentsRail.evaluate((element) => {
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
        }),
      )
      .toEqual({
        bottom: 844,
        height: 743,
        radius: "16px",
        width: 390,
        x: 0,
        y: 101,
      });

    await closeButton.click();
    await expect(panel).toHaveAttribute("data-state", "closed");
  });

  test("signed-out mobile comments open account sign-in in place", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByTestId("mobile-header-comments").click();
    const signIn = page
      .getByTestId("mobile-comments-panel")
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
    await expect(firstHeading).toHaveAttribute("data-active-outline-heading", "true");
  });

  test("phone comments panel matches legacy resizing behavior", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByTestId("mobile-header-comments").click();
    const panel = page.getByTestId("mobile-comments-panel");
    await expect(panel).toHaveAttribute("data-state", "open", { timeout: 20_000 });
    const commentsRail = panel.getByRole("complementary", {
      name: "Document comments",
    });
    const heightBefore = (await commentsRail.boundingBox())?.height ?? 0;
    const resizer = panel.getByRole("separator", { name: "Resize comments panel" });
    const box = await resizer.boundingBox();
    expect(box).not.toBeNull();

    await resizer.dispatchEvent("pointerdown", {
      bubbles: true,
      clientX: box!.x + box!.width / 2,
      clientY: box!.y + box!.height / 2,
      pointerId: 1,
      pointerType: "touch",
    });
    await page.evaluate(
      ({ x, y }) => {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: x,
            clientY: y + 80,
            pointerId: 1,
            pointerType: "touch",
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: x,
            clientY: y + 80,
            pointerId: 1,
            pointerType: "touch",
          }),
        );
      },
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );

    const heightAfter = (await commentsRail.boundingBox())?.height ?? 0;
    expect(heightAfter).toBeLessThan(heightBefore - 40);
  });

  test("desktop rail matches legacy selection-only and resize behavior", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installWikiApiMocks(page);
    await mockCommentsApi(page, [], {
      email: "parity@example.test",
      name: "Parity Reader",
    });
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("button", { name: "Open comments" }).click();
    const rail = page.locator("[data-wiki-shell-right-rail]").last();
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await expect(
      rail.getByRole("button", { name: "Add a page-level comment" }),
    ).toHaveCount(0);

    const widthBefore = (await rail.boundingBox())?.width ?? 0;
    const resizer = rail.getByRole("separator", { name: "Resize comments pane" });
    const box = await resizer.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 1, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x - 80, box!.y + box!.height / 2);
    await page.mouse.up();

    const widthAfter = (await rail.boundingBox())?.width ?? 0;
    expect(widthAfter).toBeGreaterThan(widthBefore + 40);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("comments-pane-width")))
      .toBe(String(Math.round(widthAfter)));
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

  test("matches legacy freshness, anchor filtering, and signed-out reply behavior", async ({
    page,
  }) => {
    await installWikiApiMocks(page);
    await mockCommentsApi(page, [
      commentThread({
        anchored: true,
        id: "thread-anchored",
        text: "Anchored parity comment",
      }),
      commentThread({
        anchored: false,
        id: "thread-page-level",
        text: "Page-level comment omitted from the legacy timeline",
      }),
    ]);
    const threadsRequest = page.waitForRequest("**/api/liveblocks-threads**");

    await page.goto("/comments", { waitUntil: "domcontentloaded" });

    const request = await threadsRequest;
    expect(new URL(request.url()).searchParams.get("fresh")).toBe("1");
    expect(request.headers()["cache-control"]).toBe("no-cache");
    await expect(page.getByText("Anchored parity comment")).toBeVisible();
    await expect(
      page.getByText("Page-level comment omitted from the legacy timeline"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(page.getByText("Sign in to reply")).toBeVisible();
    await expect(page.getByPlaceholder("Write a reply...")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await expect(page.getByRole("dialog", { name: "Sign in" })).toBeVisible();
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
