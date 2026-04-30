import { expect, test, type Page } from "@playwright/test";

const WIKI_ROUTE = "/wiki/diagnostics/diagnosis";
const SOURCE_ROUTE = "/sources/trials/zest-nct05306330";

function nextErrorOverlay(page: Page) {
  return page.locator(
    "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay"
  );
}

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
  await expect(item).toBeVisible({ timeout: 25_000 });
  await item.hover();
  await expect(item).toHaveAttribute("aria-selected", "true");
}

test.describe("source loading boundary", () => {
  test("wiki pages do not render the source document loading shell", async ({ page }) => {
    await page.goto(WIKI_ROUTE, { waitUntil: "networkidle" });

    await expect(page.locator("article h1").first()).toHaveText("Diagnosis");
    await expect(page.getByRole("status", { name: "Loading page" })).toHaveCount(0);
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("source pages still render cleanly through their scoped route", async ({ page }) => {
    await page.goto(SOURCE_ROUTE, { waitUntil: "networkidle" });

    await expect(page.locator("article h1").first()).toHaveText(
      "ZEST \u2014 Niraparib vs Placebo in ctDNA-Positive Breast Cancer"
    );
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("command palette Enter opens wiki results without the source loading shell", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await delayRoutePayload(page, WIKI_ROUTE);

    const input = page.getByPlaceholder(/Search pages/);
    await expect
      .poll(
        async () => {
          await page.getByRole("button", { name: /Find files/ }).click();
          return input.isVisible().catch(() => false);
        },
        { timeout: 15_000 }
      )
      .toBe(true);
    await input.fill("wiki diagnostics diagnosis");
    await chooseCommandPaletteResult(page, WIKI_ROUTE.slice(1));

    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${WIKI_ROUTE}$`), {
      timeout: 15_000,
    });

    await expect(page.getByRole("status", { name: "Loading page" })).toHaveCount(0);
    await expect(page.locator("article h1").first()).toHaveText("Diagnosis");
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });
});
