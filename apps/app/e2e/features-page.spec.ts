import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { detailItems, features, groups, interfaces } from "../src/pages/features-data";

async function openFeatures(page: Page) {
  await page.goto("/features");
  await expect(page.locator("#features-title")).toBeVisible();
}

async function loadAllImages(page: Page) {
  // Images are lazy; scroll through so each one requests its file.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
      ),
    )
    .toBe(0);
}

test("the features page tours every area and links to each from the header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openFeatures(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Everything Oncobase can do.");
  const navigation = page.getByRole("navigation", { name: "Feature groups" }).first();
  for (const [link, heading] of [
    ["Read", "#read-title"],
    ["Ask", "#ask-title"],
    ["Protect", "#protect-title"],
    ["See the data", "#data-title"],
    ["Build", "#build-title"],
    ["Details", "#details-title"],
  ]) {
    await navigation.getByRole("link", { name: link, exact: true }).click();
    await expect(page.locator(heading!)).toBeInViewport();
  }
  // The brief asks for attention to detail to be called out by name.
  await expect(page.locator("#details-title")).toHaveText("Built with attention to detail.");
  await expect(page.locator("#details tbody tr")).toHaveCount(detailItems.length);
});

test("every feature and interface is in the page's tables", async ({ page }) => {
  await openFeatures(page);
  const all = page.locator("#all table");
  for (const feature of features) {
    await expect(all.getByRole("cell", { name: feature.name, exact: true })).toBeVisible();
  }
  for (const group of groups) {
    await expect(all.getByRole("cell", { name: group.title, exact: true })).toBeVisible();
  }
  const rows = page.locator("#build details tbody tr");
  await expect(rows).toHaveCount(interfaces.length);
});

test("images load in the visitor's theme and follow the theme toggle", async ({ page }) => {
  const failed: string[] = [];
  page.on("response", (response) => {
    if ((response.url().includes("/feature-shots/") || response.url().includes("/landing/")) && response.status() >= 400) {
      failed.push(response.url());
    }
  });
  await page.emulateMedia({ colorScheme: "light" });
  await openFeatures(page);
  await loadAllImages(page);
  const themed = page.locator("#features-main img[src*='/feature-shots/'][src*='-light.'], #features-main img[src*='/feature-shots/'][src*='-dark.']");
  expect(await themed.count()).toBe(6);
  expect(await themed.evaluateAll((images) => images.every((image) => image.getAttribute("src")!.includes("-light.")))).toBe(true);

  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("#features-title")).toBeVisible();
  await loadAllImages(page);
  expect(await themed.evaluateAll((images) => images.every((image) => image.getAttribute("src")!.includes("-dark.")))).toBe(true);
  expect(failed).toEqual([]);
});

test("the light and dark compare handle moves by drag and by keyboard", async ({ page }) => {
  await openFeatures(page);
  const handle = page.getByRole("slider", { name: "Compare light and dark" });
  await handle.scrollIntoViewIfNeeded();
  const stage = page.locator(".ft-compare-stage");
  await expect(handle).toHaveAttribute("aria-valuenow", "50");
  // The handle sits on the image itself, not in a control below it.
  const stageBox = (await stage.boundingBox())!;
  const handleBox = (await handle.boundingBox())!;
  expect(handleBox.y).toBeGreaterThanOrEqual(stageBox.y - 1);
  expect(handleBox.y + handleBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height + 1);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * 0.2, handleBox.y + handleBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", /^(1[89]|2[0-2])$/);
  await handle.focus();
  await page.keyboard.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "100");
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "0");
});

for (const width of [360, 390, 1440]) {
  test(`the features page has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFeatures(page);
    await loadAllImages(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}

test("outbound links go only to the repository and credited sources", async ({ page }) => {
  await openFeatures(page);
  for (const link of await page.locator(".landing-page a[href^='http']").all()) {
    expect(["github.com", "osteosarc.com", "doi.org", "creativecommons.org"]).toContain(
      new URL((await link.getAttribute("href"))!).hostname,
    );
  }
  await expect(page.getByRole("link", { name: "osteosarc.com" })).toHaveAttribute("href", "https://osteosarc.com/");
  // The MRI image on this page keeps its CC BY credit.
  await expect(page.locator("footer")).toContainText("CC BY 4.0");
});

test("agents can read the feature lists as plain text", async ({ request }) => {
  const index = await request.get("/llms.txt");
  expect(index.status()).toBe(200);
  expect(await index.text()).toContain("features.md");
  const full = await request.get("/features.md");
  expect(full.headers()["content-type"]).toContain("markdown");
  expect(full.status()).toBe(200);
  const text = await full.text();
  for (const feature of features) expect(text).toContain(feature.name);
});

test("the features page passes automated accessibility checks in light and dark", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openFeatures(page);
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
