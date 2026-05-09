import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

function targetScrollState(id: string) {
  return {
    scrollTop: document.querySelector<HTMLElement>(".content-shell")?.scrollTop ?? window.scrollY,
    targetTop: document.getElementById(id)?.getBoundingClientRect().top ?? null,
  };
}

async function expectScrolledTo(page: import("@playwright/test").Page, id: string, minScroll = 200) {
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(targetScrollState, id);
        return (
          state.scrollTop > minScroll &&
          state.targetTop !== null &&
          state.targetTop < 180
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe("Markdown heading anchors", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("clicking a markdown heading updates the URL hash", async ({ page }) => {
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");

    const heading = documentArticle(page).getByRole("heading", {
      name: /Saturday, April 12/,
    });
    await expect(heading).toHaveClass(/wiki-heading-linked/);
    await heading.click();

    await expect(page).toHaveURL(/#saturday-april-12$/);
  });

  test("clicking a heading permalink copies the section URL", async ({ page }) => {
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");

    const heading = documentArticle(page).getByRole("heading", {
      name: /Saturday, April 12/,
    });
    await heading.hover();
    await heading.locator(".heading-anchor").click({ force: true });

    await expect(page).toHaveURL(/#saturday-april-12$/);
    await expect(page.getByRole("status")).toHaveText("Link copied");
  });

  test("deep links scroll to the target heading", async ({ page }) => {
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18#treatment-note");

    await expect(page.locator("#treatment-note")).toBeAttached();
    await expectScrolledTo(page, "treatment-note", 300);
  });

  test("same-page table-of-contents links scroll inside the article pane", async ({ page }) => {
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");

    await page.getByRole("link", { name: "the treatment note" }).click();

    await expect(page).toHaveURL(/#treatment-note$/);
    await expectScrolledTo(page, "treatment-note", 300);
  });

  test("cross-page markdown hash links use app navigation and scroll", async ({ page }) => {
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");

    await page.getByRole("link", { name: "BRCA terminology" }).click();

    await expect(page).toHaveURL(/\/about\/Terminology#brca$/);
    await waitForPageTitle(page, "Terminology");
    await expectScrolledTo(page, "brca", 200);
  });

  test("cross-page markdown links without hashes reset the article scroll", async ({ page }) => {
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18#treatment-note");
    await expect(page.locator("#treatment-note")).toBeAttached();

    await page.getByRole("link", { name: "radioligand therapy" }).click();

    await expect(page).toHaveURL(/\/wiki\/treatment\/therapeutics\/radioligand-therapy$/);
    await waitForPageTitle(page, "Radioligand Therapy");
    const scrollTop = await page.evaluate(
      () => document.querySelector<HTMLElement>(".content-shell")?.scrollTop ?? window.scrollY,
    );
    expect(scrollTop).toBeLessThan(120);
  });

  test.skip("login redirects preserve the original URL hash", async () => {
    // Auth redirects still belong to the current Next app. The Vite prototype
    // only switches public/session LiveStore stores after `/api/wiki/session`.
  });

  test.skip("command palette navigation wires anchors on the destination page", async () => {
    // The migrated reader has a local quick switcher. Full command-palette
    // parity is tracked in the migration plan before production reader parity.
  });
});
