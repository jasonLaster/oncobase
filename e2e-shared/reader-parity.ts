import { type Locator, type Page, expect, test } from "@playwright/test";

/**
 * One reader-parity suite, run against BOTH readers (Next.js `apps/web` and the
 * Vite `apps/wiki-vite`) talking to the SAME real Convex backend. Each app
 * provides an adapter (auth + selectors); the assertions are identical, so a
 * passing run in both apps is direct evidence the new reader is a drop-in
 * substitute for the legacy one.
 */
export type ReaderAdapter = {
  name: string;
  /** Authenticate / prepare so the same content is visible (no-op where public). */
  prepare?: (page: Page) => Promise<void>;
  /** Navigate to a wiki path (relative to baseURL) and wait for the article. */
  open: (page: Page, path: string) => Promise<void>;
  /** The file-tree sidebar locator (selectors differ per app). */
  sidebar: (page: Page) => Locator;
};

// Stable, public pages that exist in the shared Convex deployment. Titles are
// the real page titles, so both readers must render them identically.
export const PARITY_PAGES = [
  { path: "/wiki/logistics/insurance", title: "Insurance & supplemental benefits Planning" },
  { path: "/about/Terminology", title: "Terminology" },
];

const LONG = 90_000;

export function registerReaderParity(adapter: ReaderAdapter) {
  test.describe(`reader parity [${adapter.name}]`, () => {
    test.beforeEach(async ({ page }) => {
      await adapter.prepare?.(page);
    });

    for (const { path, title } of PARITY_PAGES) {
      test(`renders ${path} from the real backend with its title + body`, async ({ page }) => {
        test.setTimeout(120_000);
        await adapter.open(page, path);

        // The shared WikiPageHeader renders the real Convex page title.
        await expect(page.locator(".page-header h1").first()).toContainText(title, {
          timeout: LONG,
        });

        // The shared markdown renderer produced a substantial body.
        const article = page.getByTestId("document-article").first();
        await expect
          .poll(async () => (await article.innerText()).length, { timeout: LONG })
          .toBeGreaterThan(200);
      });
    }

    test("file-tree sidebar renders the wiki sections", async ({ page }) => {
      test.setTimeout(120_000);
      await adapter.open(page, "/wiki/logistics/insurance");

      const sidebar = adapter.sidebar(page);
      await expect(sidebar).toBeVisible({ timeout: LONG });
      await expect(sidebar.getByRole("button", { name: /wiki/i }).first()).toBeVisible();
    });

    test("markdown headings get anchor slugs (shared renderer)", async ({ page }) => {
      test.setTimeout(120_000);
      await adapter.open(page, "/about/Terminology");

      // rehype-slug (in the shared markdown pipeline) gives body headings ids,
      // which the heading-anchor enhancer turns into linkable anchors.
      const article = page.getByTestId("document-article").first();
      await expect(article.locator("h2[id], h3[id]").first()).toBeVisible({ timeout: LONG });
    });

    test("renders markdown block structure, not just text (shared renderer)", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await adapter.open(page, "/wiki/logistics/insurance");

      // Both render paths emit real block elements; a prose page always has
      // paragraphs. A length-only check can't tell rendered HTML from raw text,
      // so assert the shared pipeline actually produced <p> blocks.
      const article = page.getByTestId("document-article").first();
      await expect(article.locator("p").first()).toBeVisible({ timeout: LONG });
    });

    test("applies the dark theme from the shared `theme` key", async ({ page }) => {
      test.setTimeout(120_000);

      // Both readers resolve the same `theme` localStorage key to a `dark` class
      // on <html> (shared applyWikiTheme / legacy themeEffect, byte-identical
      // behavior). Seeding it before any page script runs is deterministic — no
      // toggle-click, so no animation/timing flake.
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem("theme", "dark");
        } catch {
          /* storage may be unavailable; the assertion below will surface it */
        }
      });
      await adapter.open(page, "/about/Terminology");

      await expect(page.locator("html")).toHaveClass(/\bdark\b/, { timeout: LONG });
    });
  });
}
