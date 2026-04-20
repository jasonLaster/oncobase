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

    await page.getByRole("button", { name: /Find files/ }).click();
    const input = page.getByPlaceholder("Search pages");
    await input.fill("wiki diagnostics diagnosis");
    await expect(page.locator('[cmdk-item][data-value="wiki/diagnostics/diagnosis"]')).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await input.press("Enter");

    await expect(page.getByRole("status", { name: "Opening page" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading page" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${WIKI_ROUTE}$`));
    await expect(page.locator("article h1").first()).toHaveText("Diagnosis");
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });
});
