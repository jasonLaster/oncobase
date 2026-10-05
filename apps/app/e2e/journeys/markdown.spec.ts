import { expect, test, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "../fixtures";

function targetScrollState(id: string) {
  const container = document.querySelector<HTMLElement>(".content-shell");
  const header = document.querySelector<HTMLElement>('[data-test-id="mobile-page-header"]');
  return {
    scrollTop: container?.scrollTop ?? window.scrollY,
    targetTop: document.getElementById(id)?.getBoundingClientRect().top ?? null,
    visibleTop: Math.max(container?.getBoundingClientRect().top ?? 0, header?.getBoundingClientRect().bottom ?? 0),
  };
}

async function expectScrolledTo(page: Page, id: string, minScroll = 200) {
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(targetScrollState, id);
        return (
          state.scrollTop > minScroll &&
          state.targetTop !== null &&
          state.targetTop >= state.visibleTop - 1 &&
          state.targetTop < 180
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

const mathSource =
  "# Insurance\n\nNew equations: $x^2$.\n\n``` math\nx+y\n```\n\n<code class=\"math-inline\">z^2</code>\n\nCost $200/month.";
const mathChunk = /\/(?:vendor-math-[^/]+\.js|.*rehype-katex.*)$/;

/** Mocked markdown rendering: anchors, scroll ownership, lazy math, diagrams. */
test.describe("markdown rendering (mocked backend)", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("headings link themselves: click updates the hash, the permalink copies it, deep links and in-page links scroll the article pane", async ({ page }) => {
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true);

    const heading = documentArticle(page).getByRole("heading", { name: /Saturday, April 12/ });
    await expect(heading).toHaveClass(/wiki-heading-linked/);
    await heading.click();
    await expect(page).toHaveURL(/#saturday-april-12$/);

    await heading.getByRole("link", { name: /Link to/ }).press("Enter");
    await expect(documentArticle(page).getByRole("status")).toHaveText("Link copied");

    await page.getByRole("link", { name: "the treatment note" }).click();
    await expect(page).toHaveURL(/#treatment-note$/);
    await expectScrolledTo(page, "treatment-note", 300);

    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18#treatment-note");
    await expectScrolledTo(page, "treatment-note", 300);
  });

  test("cross-page markdown links use app navigation: hashes scroll to the target, hashless links reset scroll", async ({ page }) => {
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");
    await page.getByRole("link", { name: "BRCA terminology" }).click();
    await expect(page).toHaveURL(/\/about\/Terminology#brca$/);
    await waitForPageTitle(page, "Terminology");
    await expectScrolledTo(page, "brca", 200);

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

  test("the mobile outline jumps below the fixed header, including after reload", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");
    await page.getByTestId("bottom-nav-trigger").click();
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await page.getByRole("button", { name: "Treatment note", exact: true }).click();

    await expect(page).toHaveURL(/#treatment-note$/);
    await expect(page.getByTestId("bottom-nav-sheet")).toHaveAttribute("aria-hidden", "true");
    await expectScrolledTo(page, "treatment-note", 300);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expectScrolledTo(page, "treatment-note", 300);
  });

  test("math loads lazily and renders all modes, currency stays literal, and a background edit keeps the article mounted until ready", async ({ page }) => {
    const api = await installWikiApiMocks(page, {
      pageOverrides: { "about/About": { title: "Insurance", content: mathSource } },
    });
    const requests: string[] = [];
    page.on("request", (request) => {
      if (mathChunk.test(new URL(request.url()).pathname)) requests.push(request.url());
    });
    await gotoWiki(page, "/wiki/logistics/insurance");
    expect(requests).toHaveLength(0);

    // A background edit that introduces math must not blank the mounted article.
    const original = await documentArticle(page).locator(".wiki-markdown").elementHandle();
    expect(original).toBeTruthy();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await page.route(mathChunk, async (route) => {
      requested = true;
      await held;
      await route.fallback();
    });
    try {
      api.setPageOverride("wiki/logistics/insurance", { content: mathSource });
      await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
      await expect.poll(() => requested).toBe(true);
      await expect(documentArticle(page)).toContainText("Prior authorization");
      expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
      release();
      await expect(documentArticle(page).locator(".katex")).toHaveCount(3);
      await expect(page.getByTestId("page-loading")).toHaveCount(0);
    } finally {
      release();
    }

    // The engine is loaded now: every math mode renders and currency stays literal.
    await gotoWiki(page, "/about/About");
    await expect(documentArticle(page).locator(".katex")).toHaveCount(3);
    await expect(documentArticle(page)).toContainText("Cost $200/month.");
    expect(requests.length).toBeGreaterThan(0);
  });

  test("mermaid gantt upgrades its fallback into a rendered SVG", async ({ page }) => {
    await gotoWiki(page, "/wiki/timeline/gantt");

    const article = documentArticle(page);
    const diagram = article.getByTestId("mermaid-diagram");
    await expect(diagram).toBeVisible();
    await expect(diagram).toHaveAttribute("data-graph", /.+/);
    await expect(diagram.locator("svg")).toBeVisible({ timeout: 25_000 });
    await expect(article.locator(".mermaid-error")).toHaveCount(0);
    await expect(diagram).toContainText("Care Timeline");
    await expect(diagram).toContainText("Chemo");
  });
});
