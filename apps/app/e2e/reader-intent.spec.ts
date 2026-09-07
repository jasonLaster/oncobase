import { expect } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

const target = "wiki/logistics/insurance";

for (const intent of ["hover", "focus"] as const) {
  test(`${intent} warms a document without ranking history or a navigation fetch`, async ({ page }) => {
    const requests = await installWikiApiMocks(page);
    await gotoWiki(page, "/");
    const link = documentArticle(page).getByRole("link", { name: "Insurance", exact: true });
    const warmed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/wiki/pages" && new URL(response.url()).searchParams.get("slugs") === target);
    await link[intent]();
    await (await warmed).finished();
    await expect.poll(() => requests.pages.length).toBe(2);
    // Stop all body networking: the destination must come from LiveStore.
    await page.route("**/api/wiki/pages**", route => route.abort());
    await link.click();
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Claims follow-up");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    expect(requests.pages).toHaveLength(2);
  });
}

for (const condition of ["save-data", "hidden", "storage-pressure"] as const) {
  test(`focused intent respects ${condition}`, async ({ page }) => {
    await page.addInitScript(condition => {
      if (condition === "save-data") Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
      if (condition === "hidden") Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      if (condition === "storage-pressure") {
        const storage = navigator.storage;
        Object.defineProperty(navigator, "storage", { get: () => storage });
        storage.estimate = async () => ({ usage: 900, quota: 1000 });
      }
    }, condition);
    const requests = await installWikiApiMocks(page);
    await gotoWiki(page, "/");
    if (condition === "storage-pressure") expect(await page.evaluate(() => navigator.storage.estimate())).toEqual({ usage: 900, quota: 1000 });
    await documentArticle(page).getByRole("link", { name: "Insurance", exact: true }).focus();
    await expect(page.waitForRequest(request => new URL(request.url()).searchParams.get("slugs") === target, { timeout: 1000 })).rejects.toThrow(/Timeout/);
    expect(requests.pages).toHaveLength(1);
  });
}

test("brief hover and external or unknown links never speculate", async ({ page }) => {
  const requests = await installWikiApiMocks(page, { pageOverrides: { index: { content: "# Home\n\n[Insurance](/wiki/logistics/insurance)\n\n[External](https://example.com/wiki/logistics/insurance)\n\n[Unknown](/not-in-the-manifest)" } } });
  await gotoWiki(page, "/");
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('a[href="/wiki/logistics/insurance"]')!;
    link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    link.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
  });
  await documentArticle(page).getByRole("link", { name: "External", exact: true }).focus();
  await documentArticle(page).getByRole("link", { name: "Unknown", exact: true }).focus();
  await expect(page.waitForRequest(request => new URL(request.url()).pathname === "/api/wiki/pages", { timeout: 1000 })).rejects.toThrow(/Timeout/);
  expect(requests.pages).toHaveLength(1);
});

for (const mobile of [false, true]) {
  test(`manifest paints destination context before a delayed body (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    const title = mobile ? "Insurance and paperwork planning for follow-up appointments" : "Insurance";
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await installWikiApiMocks(page, { pageOverrides: { [target]: { title, description: "Plan ahead for insurance paperwork.", tags: ["logistics"] } } });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/wiki/pages**", async route => { await held; await route.fallback(); });
    let titleBox: { x: number; y: number; height: number } | null = null;
    try {
      await page.goto(`/${target}`, { waitUntil: "domcontentloaded" });
      await expect(documentArticle(page).getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByTestId("page-loading-description")).toHaveText("Plan ahead for insurance paperwork.");
      await expect(documentArticle(page).getByRole("link", { name: "logistics", exact: true })).toBeVisible();
      await expect(documentArticle(page).locator("[aria-busy=true]")).toBeVisible();
      await expect(page.getByTestId("page-loading")).toBeVisible();
      titleBox = await documentArticle(page).getByRole("heading", { name: title, exact: true }).boundingBox();
      await page.screenshot({ path: test.info().outputPath("manifest-first.png") });
    } finally { release(); }
    await expect(documentArticle(page)).toContainText("Claims follow-up");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    const heading = documentArticle(page).getByRole("heading", { name: title, exact: true });
    await expect(heading).toHaveCount(1);
    const loadedBox = await heading.boundingBox();
    expect(Math.abs(loadedBox!.x - titleBox!.x)).toBeLessThan(1);
    expect(Math.abs(loadedBox!.y - titleBox!.y)).toBeLessThan(1);
    expect(Math.abs(loadedBox!.height - titleBox!.height)).toBeLessThan(1);
  });
}
