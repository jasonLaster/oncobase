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
const figuresChunk = /\/(?:figures-[^/]+\.js|figures\.tsx)(?:\?.*)?$/;

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
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Link copied");

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
    await page.getByRole("tab", { name: "Outline", exact: true }).click();
    await page.getByRole("button", { name: "Treatment note", exact: true }).click();

    await expect(page).toHaveURL(/#treatment-note$/);
    await expect(page.getByTestId("bottom-nav-sheet")).toBeHidden();
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

  test("handout layout renders callouts, responsive columns, and lazy data figures with fallback table before load", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(figuresChunk, async (route) => {
      await held;
      await route.fallback();
    });

    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoWiki(page, "/wiki/examples/handout-layout");
      const article = documentArticle(page);

      // Callouts render with their tone classes and foldable <details>.
      await expect(article.locator('.wiki-callout[data-callout="summary"]')).toBeVisible();
      await expect(article.locator('.wiki-callout[data-callout="question"]')).toBeVisible();
      const details = article.locator('details.wiki-callout[data-callout="note"]');
      await expect(details).toBeVisible();
      await expect(details).not.toHaveAttribute("open", "");
      await details.locator("summary").click();
      await expect(details).toHaveAttribute("open", "");

      // Columns render side by side on desktop.
      const cols = article.locator(".wiki-columns .wiki-column");
      await expect(cols).toHaveCount(2);
      const desktopBox0 = (await cols.nth(0).boundingBox())!;
      const desktopBox1 = (await cols.nth(1).boundingBox())!;
      expect(desktopBox1.x).toBeGreaterThan(desktopBox0.x + desktopBox0.width * 0.5);

      // Before the lazy figures chunk resolves, the accessible fallback table and caption are visible.
      const figure = article.getByTestId("wiki-figure");
      await expect(figure).toBeVisible();
      await expect(figure.locator("table")).toBeVisible();
      await expect(figure).toContainText("41%");
      await expect(figure).toContainText("Share of all recurrences by year after surgery.");
      await expect(figure.locator("svg")).toHaveCount(0);

      // Release the figures chunk and verify SVG upgrades cleanly.
      release();
      await expect(figure.locator("svg")).toBeVisible({ timeout: 15_000 });
      await expect(figure).toHaveAttribute("data-figure-rendered", "true");
      await expect(figure.locator("svg")).toContainText("73% in the first 2 years");

      // At phone width (390px), columns stack vertically.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(async () => {
        const b0 = (await cols.nth(0).boundingBox())!;
        const b1 = (await cols.nth(1).boundingBox())!;
        return b1.y >= b0.y + b0.height - 2 && Math.abs(b1.x - b0.x) < 4;
      }).toBe(true);

      // The figure data stays in the accessibility tree without widening the reader.
      await expect(figure.getByRole("table").getByRole("cell", { name: "13%" })).toBeAttached();
      const shell = page.locator(".content-shell");
      await expect.poll(() => shell.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const comparison = article.locator(".smart-table-wrapper, .table-scroll-wrapper").filter({ hasText: "One-cycle bridge" });
      await expect.poll(() => comparison.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    } finally {
      release();
    }
  });
});
