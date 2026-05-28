import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

const runsWithPreviewAuth = Boolean(
  process.env.PLAYWRIGHT_BASE_URL && process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD,
);

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

  test("login page preserves the hash so anchors resolve after sign-in", async ({ page }) => {
    test.skip(runsWithPreviewAuth, "Preview e2e starts authenticated to exercise protected wiki pages.");

    // The web counterpart drives the password gate end-to-end (gate → /login →
    // password submit → redirect with hash → scroll-to-anchor). In Vite the
    // password gate lives in the standalone Bun server and is exercised by
    // `verify:wiki-vite:server`, which boots the gate and proves the redirect
    // round-trip. At the dev-server layer we verify only the contract: the
    // login page surfaces the redirect target including the hash so the
    // post-login navigation can restore it.
    await installWikiApiMocks(page);
    const target = "/wiki/updates/week-5-april-12-to-18#saturday-april-12";
    await page.goto(`/login?redirect=${encodeURIComponent(target)}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("login-page")).toContainText(target);
    await expect(page.getByRole("link", { name: "Back to reader" })).toHaveAttribute(
      "href",
      target,
    );
  });

  test("command palette navigation wires anchors on the destination page", async ({ page }) => {
    await gotoWiki(page, "/about/About");
    await expect(documentArticle(page).locator("h1").first()).toHaveText(
      "About This Wiki",
    );

    await page.keyboard.press("ControlOrMeta+K");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible({ timeout: 5000 });

    const input = page.getByTestId("command-palette-input");
    await input.fill("terminology");
    const terminologyRow = palette
      .getByRole("option", { name: /terminology/i })
      .first();
    await expect(terminologyRow).toBeVisible({ timeout: 5000 });
    await input.press("Enter");

    await expect(page).toHaveURL(/\/about\/Terminology$/);
    await waitForPageTitle(page, "Terminology");

    const survival = documentArticle(page).locator("h2#survival-endpoints");
    await expect(survival).toHaveClass(/wiki-heading-linked/);
    await survival.click();
    await expect(page).toHaveURL(/\/about\/Terminology#survival-endpoints$/);
  });
});
