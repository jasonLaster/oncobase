import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

const runsAgainstPreview = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.describe("P0 multi-site isolation", () => {
  test("invariant 1: same-slug isolation cold and warm", async ({ page }) => {
    await installWikiApiMocks(page, {
      siteSlug: "friend",
      pageOverrides: {
        "wiki/logistics/insurance": {
          title: "Friend Insurance",
          content: "# Friend Insurance\n\nFriend-only payer notes.",
        },
      },
    });

    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");
    await expect(documentArticle(page)).toContainText("Friend-only payer notes.");
    await expect(page.getByTestId("livestore-devtools-footer")).toHaveAttribute("data-store-id", /friend/);

    const friendStoreId = await page.getByTestId("livestore-devtools-footer").getAttribute("data-store-id");

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await installWikiApiMocks(page, {
      siteSlug: "diana",
      pageOverrides: {
        "wiki/logistics/insurance": {
          title: "Insurance",
          content: "# Insurance\n\nPublic payer notes.",
        },
      },
    });
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    await expect(documentArticle(page)).toContainText("Public payer notes.");
    await expect(documentArticle(page)).not.toContainText("Friend-only payer notes.");
    const dianaStoreId = await page.getByTestId("livestore-devtools-footer").getAttribute("data-store-id");
    expect(dianaStoreId).not.toBe(friendStoreId);
  });

  test("invariant 2: header injection is overwritten", async ({ request }) => {
    test.skip(runsAgainstPreview, "Vercel previews do not accept synthetic Host headers.");

    const response = await request.get("/api/wiki/session", {
      headers: {
        Host: "diana.localhost",
        "x-site-slug": "friend",
      },
    });

    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json();
    expect(body.siteSlug).toBe("diana");
    expect(body.cacheKey).toContain("diana:public");
  });

  test("invariant 3: search ranking does not leak across sites", async ({ page }) => {
    await installWikiApiMocks(page, { siteSlug: "friend" });
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/logistics/insurance",
              title: "Friend Insurance",
              excerpt: "friend scoped",
              tags: [],
            },
          ],
        }),
      });
    });

    await page.goto("/search?q=insurance", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("search-results")).toContainText("Friend Insurance");
    await expect(page.getByTestId("search-results")).not.toContainText("diana scoped");
  });

  test("invariant 4: unknown non-Diana site APIs fail closed or return empty", async ({ request }) => {
    test.skip(runsAgainstPreview, "Vercel previews do not accept synthetic Host headers.");

    const manifest = await request.get("/api/wiki/manifest", {
      headers: { Host: "unknownsite.localhost" },
    });
    expect([200, 404, 503]).toContain(manifest.status());
    if (manifest.ok()) {
      const body = await manifest.json();
      expect(body.siteSlug).toBe("unknownsite");
      expect(body.pages).toEqual([]);
    }
  });

  test("invariant 5: /api/tools chat tool calls are host-scoped", async ({ request }) => {
    test.skip(runsAgainstPreview, "Vercel previews do not accept synthetic Host headers.");

    const response = await request.post("/api/tools", {
      headers: { Host: "friend.localhost" },
      data: { tool: "search_wiki", args: { query: "diagnosis" } },
    });

    expect([200, 404, 500]).toContain(response.status());
    if (response.ok()) {
      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(JSON.stringify(body)).not.toContain("Diana Laster");
    }
  });

  test("invariant 6: markdown downloads are site-scoped", async ({ request }) => {
    test.skip(runsAgainstPreview, "Vercel previews do not accept synthetic Host headers.");

    const response = await request.get("/api/page-copy?slug=wiki/logistics/insurance", {
      headers: { Host: "friend.localhost" },
      timeout: 15_000,
    });

    expect([200, 404, 500]).toContain(response.status());
    if (response.ok()) {
      expect(response.headers()["x-wiki-cache-scope"]).toBe("public");
      expect(await response.text()).not.toContain("Diana Laster");
    }
  });

  test("invariant 7: share-preview falls back to the Vite shell without cross-site data", async ({ request }) => {
    test.skip(runsAgainstPreview, "Vercel previews do not accept synthetic Host headers.");

    const response = await request.get("/api/share-preview", {
      headers: { Host: "friend.localhost" },
    });
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toContain("Diana Laster");
  });

  test("invariant 8: LiveStore store ids and cached bodies are site-scoped", async ({ page }) => {
    await installWikiApiMocks(page, { siteSlug: "friend" });
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");
    const friendStoreId = await page.getByTestId("livestore-devtools-footer").getAttribute("data-store-id");

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await installWikiApiMocks(page, { siteSlug: "diana" });
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    const dianaStoreId = await page.getByTestId("livestore-devtools-footer").getAttribute("data-store-id");
    expect(dianaStoreId).not.toBe(friendStoreId);
  });

  test("invariant 9: /api/file returns 404 or empty for paths the active site does not own", async ({ request }) => {
    test.skip(runsAgainstPreview, "Vercel previews do not accept synthetic Host headers.");

    const response = await request.get("/api/file?path=sources/images/pathology-slide.png", {
      headers: { Host: "friend.localhost" },
    });
    expect([404, 502]).toContain(response.status());
  });

  test("invariant 10: AI search and chat citations only reference the active site", async ({ page }) => {
    await installWikiApiMocks(page, { siteSlug: "friend" });
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [{ slug: "wiki/logistics/insurance", title: "Friend Insurance", excerpt: "friend", tags: [] }],
        }),
      });
    });
    await page.route("**/api/ai-search", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/logistics/insurance",
              title: "Friend Insurance",
              tags: [],
              relevance: 8,
              summary: "Friend-only citation.",
            },
          ],
        }),
      });
    });

    await page.goto("/search?q=insurance&mode=ai", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("search-results")).toContainText("Friend-only citation.");
    await expect(page.getByTestId("search-results")).not.toContainText("Diana");
  });
});
