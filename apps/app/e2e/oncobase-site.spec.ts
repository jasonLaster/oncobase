import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { dianaBaseURL, isLocalBase, marketingBaseURL, useMarketingSite } from "./marketing";

useMarketingSite();

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.locator("#oncobase-title")).toBeVisible();
}

test("the home page says what Oncobase is and sends people on to the details", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openHome(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Take control of your care.");
  await expect(page).toHaveTitle(/Oncobase/);
  // The sub header lists this page's sections and tracks the one in view.
  const sections = page.getByRole("navigation", { name: "Page sections" });
  for (const [link, heading] of [
    ["What it does", "#what-title"],
    ["Which path", "#paths-title"],
    ["For agents", "#agents-title"],
    ["Why it exists", "#story-title"],
  ]) {
    await sections.getByRole("link", { name: link, exact: true }).click();
    await expect(page.locator(heading)).toBeInViewport();
    await expect(sections.getByRole("link", { name: link, exact: true })).toHaveAttribute("aria-current", "location");
  }
  // The tour cards open the matching part of the features page, on this site.
  const cards = page.locator(".lp-tour > a");
  await expect(cards).toHaveCount(4);
  for (const card of await cards.all()) expect(await card.getAttribute("href")).toMatch(/^\/features#/);
  // It points most people at something simpler, and says so.
  await expect(page.locator("#paths")).toContainText("Most people don’t need Oncobase");
  await expect(page.locator("#paths").getByRole("link", { name: /Compare the options/ })).toHaveAttribute("href", "/compare#choose");
  // Diana's site is the live example, on its own domain.
  const example = page.locator("#story").getByRole("link", { name: /Diana’s knowledge base/ });
  expect(new URL((await example.getAttribute("href"))!).origin).not.toBe(new URL(marketingBaseURL).origin);
});

test("the primary header is the same on every page of the site, and the logo goes home", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const seen: string[][] = [];
  for (const path of ["/", "/features", "/compare"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    seen.push(await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link").allTextContents());
    await expect(page.locator("header").getByRole("link", { name: "Oncobase home" })).toHaveAttribute("href", "/");
  }
  expect(seen).toEqual([["Features", "Compare"], ["Features", "Compare"], ["Features", "Compare"]]);
  await page.getByRole("link", { name: "Oncobase home" }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test("the marketing site never opens the reader, the wiki API, or the database", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || /WikiViteRoot|LiveStoreRoot/.test(url.pathname)) requests.push(url.pathname);
  });
  for (const path of ["/", "/features", "/compare"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  // The reader's shortcuts and module preloads are skipped on this host.
  expect(await page.evaluate(() => Boolean((window as unknown as { __wikiReaderShortcuts?: unknown }).__wikiReaderShortcuts))).toBe(false);
  expect(await page.locator("link[data-reader]").count()).toBe(0);
  expect(requests).toEqual([]);
});

test("pages that belong to Diana's site are not found here", async ({ page }) => {
  for (const path of ["/wiki/index", "/sign-in", "/education", "/nope"]) {
    await page.goto(path);
    await expect(page.getByTestId("marketing-not-found")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found.");
  }
});

test("the old Oncobase pages on Diana's site redirect here", async ({ request }) => {
  test.skip(!isLocalBase, "Needs the local dev server's host routing.");
  for (const path of ["/features", "/compare"]) {
    const response = await request.get(`${dianaBaseURL}${path}`, { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers().location).toBe(`${marketingBaseURL}${path}`);
  }
});

for (const width of [360, 390, 768, 1280, 1440]) {
  test(`the marketing pages have no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const overflowing: string[] = [];
    for (const path of ["/", "/features", "/compare"]) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) overflowing.push(`${path} (+${overflow}px)`);
    }
    expect(overflowing).toEqual([]);
  });
}

test("the home page passes automated accessibility checks in light and dark", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openHome(page);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const results = await (window as unknown as {
        axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ html: string }> }> }> };
      }).axe.run(document, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      });
      return results.violations
        .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
        .map((violation) => ({ id: violation.id, html: violation.nodes.slice(0, 2).map((node) => node.html.slice(0, 120)) }));
    });
    expect(violations, `${scheme} theme`).toEqual([]);
  }
});
