import { expect, test, type Page } from "@playwright/test";
import { documentArticle, nextErrorOverlay, openCommandPalette } from "./helpers";

const WIKI_ROUTE = "/wiki/diagnostics/diagnosis";
const SOURCE_ROUTE = "/sources/clinical-trials/trials/zest-nct05306330";

async function delayRoutePayload(page: Page, routePath: string) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isRoutePayload =
      url.pathname === routePath &&
      url.searchParams.has("_rsc") &&
      request.resourceType() === "fetch";

    if (isRoutePayload) {
      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    await route.continue();
  });
}

async function chooseCommandPaletteResult(page: Page, slug: string) {
  const item = page.locator(`[cmdk-item][data-value="${slug}"]`);
  await expect(item).toBeVisible({ timeout: 30_000 });
}

test.describe("source loading boundary", () => {
  test("wiki pages do not render the source document loading shell", async ({ page }) => {
    await page.goto(WIKI_ROUTE, { waitUntil: "domcontentloaded" });

    await expect(documentArticle(page).locator("h1")).toHaveText("Diagnosis");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("source pages still render cleanly through their scoped route", async ({ page }) => {
    await page.goto(SOURCE_ROUTE, { waitUntil: "domcontentloaded" });

    await expect(documentArticle(page).locator("h1")).toHaveText(
      "ZEST \u2014 Niraparib vs Placebo in ctDNA-Positive Breast Cancer"
    );
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("source route shell includes the loading state before streamed content", async ({
    page,
  }) => {
    const response = await page.request.get(SOURCE_ROUTE);
    expect(response.ok()).toBe(true);
    const html = await response.text();

    expect(html).toContain('data-test-id="page-loading"');
    expect(html).toContain(
      "ZEST \u2014 Niraparib vs Placebo in ctDNA-Positive Breast Cancer"
    );
    expect(html).not.toContain("data-nextjs-dialog");
  });

  test("command palette Enter opens wiki results without the source loading shell", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await delayRoutePayload(page, WIKI_ROUTE);

    const input = await openCommandPalette(page);
    await input.fill("wiki diagnostics diagnosis", { force: true });
    await chooseCommandPaletteResult(page, WIKI_ROUTE.slice(1));

    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${WIKI_ROUTE}$`), {
      timeout: 15_000,
    });

    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    await expect(documentArticle(page).locator("h1")).toHaveText("Diagnosis");
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });
});
