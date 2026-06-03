import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

// Document comments in the Vite reader are powered by the shared
// @oncobase/wiki-comments package + Liveblocks, reusing the same Convex
// deployment as the Next.js reader. They need a live Liveblocks workspace, so
// they are NOT part of the default mocked suite (which pins comments off for a
// deterministic outline rail). Run them against a comments-enabled server:
//
//   NEXT_PUBLIC_ENABLE_COMMENTS=true bun dev          # in one shell
//   WIKI_VITE_TEST_COMMENTS=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:<port> \
//     bunx playwright test comments.spec
const RUN_COMMENTS = process.env.WIKI_VITE_TEST_COMMENTS === "1";

test.describe("Document comments", () => {
  test.skip(
    !RUN_COMMENTS,
    "Set WIKI_VITE_TEST_COMMENTS=1 and target a comments-enabled server (Liveblocks).",
  );

  test.beforeEach(async ({ page }) => {
    // Mock wiki content for fast, deterministic pages; /api/liveblocks-auth is
    // left unmocked so it hits the real Liveblocks-backed server.
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");
  });

  test("renders the comments rail with Comments / Outline tabs", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Comments" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Outline" }).first()).toBeVisible();
    // Liveblocks connection resolved: a thread count is shown (0 or more). Both
    // rails carry the text in the DOM, so scope to the visible (desktop) one.
    await expect(
      page.getByText(/unresolved threads?/i).filter({ visible: true }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("exposes a page-level composer once Liveblocks authorizes", async ({ page }) => {
    await expect(
      page.getByText("Add a page-level comment").filter({ visible: true }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("switches between the Comments and Outline rail views", async ({ page }) => {
    const composer = page.getByText("Add a page-level comment").filter({ visible: true });
    await expect(composer).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Outline" }).filter({ visible: true }).first().click();
    await expect(composer).toHaveCount(0);

    await page.getByRole("button", { name: "Comments" }).filter({ visible: true }).first().click();
    await expect(composer).toBeVisible();
  });
});
