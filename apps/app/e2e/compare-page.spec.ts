import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { goals, matrix, matrixOrder, oncobasePieces, otherOpenSource, products, productName } from "../src/pages/compare-data";

async function openCompare(page: Page) {
  await page.goto("/compare");
  await expect(page.locator("#compare-title")).toBeVisible();
}

test("the comparison page answers 'which should I use?' before it sells Oncobase", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCompare(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How Oncobase compares.");
  // The honest nudge and the disclosure sit above the fold's end.
  await expect(page.locator(".cp-not-sure")).toContainText("Start with Notion");
  await expect(page.locator(".cp-disclosure")).toContainText("we’re not neutral");
  // Most goals send people to something other than Oncobase.
  const goalRows = page.locator(".cp-goal");
  await expect(goalRows).toHaveCount(goals.length);
  const picks = await goalRows.locator(".cp-chip[data-lead]").allTextContents();
  expect(picks.filter((name) => name !== "Oncobase").length).toBeGreaterThan(picks.length / 2);
  // The header links to every section and tracks the one in view.
  const navigation = page.getByRole("navigation", { name: "Comparison sections" });
  for (const [link, heading] of [
    ["Which one?", "#choose-title"],
    ["Side by side", "#table-title"],
    ["Each option", "#options-title"],
    ["Build your own", "#build-title"],
    ["Sources", "#sources-title"],
  ]) {
    await navigation.getByRole("link", { name: link }).click();
    await expect(page.locator(heading)).toBeInViewport();
    await expect(navigation.getByRole("link", { name: link })).toHaveAttribute("aria-current", "location");
  }
});

test("the table covers every product and keeps the Oncobase column in view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCompare(page);
  const table = page.locator(".cp-matrix table");
  await expect(table.locator("thead th")).toHaveCount(matrixOrder.length + 1);
  await expect(table.locator("tbody tr")).toHaveCount(matrix.length);
  for (const id of matrixOrder) await expect(table.locator("thead th", { hasText: productName(id) })).toHaveCount(1);
  // On desktop the whole table fits, so no column hides off to the right.
  expect(await page.locator(".cp-matrix").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  // On a phone it scrolls sideways, the question column stays put, and Oncobase is the first column after it.
  await page.setViewportSize({ width: 390, height: 844 });
  const wrap = page.locator(".cp-matrix");
  expect(await wrap.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await wrap.evaluate((element) => element.scrollTo({ left: 400 }));
  const question = (await page.locator(".cp-matrix tbody th").first().boundingBox())!;
  const wrapBox = (await wrap.boundingBox())!;
  expect(Math.abs(question.x - wrapBox.x)).toBeLessThan(2);
  const oncobase = table.locator("thead th", { hasText: "Oncobase" });
  await wrap.evaluate((element) => element.scrollTo({ left: 0 }));
  const oncobaseBox = (await oncobase.boundingBox())!;
  expect(oncobaseBox.x).toBeLessThan(wrapBox.x + wrapBox.width);
});

test("every product and reusable piece is listed, with options collapsed until opened", async ({ page }) => {
  await openCompare(page);
  const options = page.locator("#options details");
  await expect(options).toHaveCount(products.length);
  expect(await options.evaluateAll((items) => items.some((item) => (item as HTMLDetailsElement).open))).toBe(false);
  await options.first().locator("summary").click();
  await expect(options.first()).toHaveJSProperty("open", true);
  await expect(options.first()).toContainText("Great at");
  for (const piece of [...oncobasePieces, ...otherOpenSource]) {
    await expect(page.locator("#build").getByRole("link", { name: piece.name })).toBeVisible();
  }
});

for (const width of [360, 390, 1440]) {
  test(`the comparison page has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openCompare(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}

test("outbound links go only to the products and sources it names", async ({ page }) => {
  await openCompare(page);
  const allowed = [
    "github.com",
    "www.notion.com",
    "obsidian.md",
    "yugabio.com",
    "www.citizen.health",
    "www.medplum.com",
    "www.healthier.inc",
    "onco.cc",
    "osteosarc.com",
    "www.npmjs.com",
  ];
  for (const link of await page.locator(".landing-page a[href^='http']").all()) {
    expect(allowed).toContain(new URL((await link.getAttribute("href"))!).hostname);
  }
  // Every outbound link opens safely in a new tab.
  const unsafe = await page
    .locator(".landing-page a[href^='http']")
    .evaluateAll((links) => links.filter((link) => link.getAttribute("rel") !== "noopener noreferrer").map((link) => link.getAttribute("href")));
  expect(unsafe).toEqual([]);
});

test("agents can read the comparison as plain text", async ({ request }) => {
  const index = await request.get("/llms.txt");
  expect(await index.text()).toContain("compare.md");
  const response = await request.get("/compare.md");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("markdown");
  const text = await response.text();
  for (const product of products) expect(text).toContain(product.name);
  expect(text).toContain("October 2026");
});

test("the comparison page passes automated accessibility checks in light and dark", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openCompare(page);
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
