import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

test("a healthy persisted reader initializes only its active SQLite runtime on the main thread", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Count the normal persistent Chromium path; storage fallback is covered separately in both browsers");
  await page.addInitScript(() => {
    const probe = { count: 0 };
    Object.assign(window, { __sqliteInstances: probe });
    for (const key of ["instantiate", "instantiateStreaming"] as const) {
      const original = WebAssembly[key];
      Object.defineProperty(WebAssembly, key, { configurable: true, value: (...args: unknown[]) => {
        probe.count++;
        return Reflect.apply(original, WebAssembly, args);
      } });
    }
  });
  const warnings: string[] = [];
  page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
  expect(warnings.filter(value => /temporary|timed out/.test(value))).toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __sqliteInstances: { count: number } }).__sqliteInstances.count)).toBe(1);
  await page.reload();
  await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
  expect(await page.evaluate(() => (window as typeof window & { __sqliteInstances: { count: number } }).__sqliteInstances.count)).toBe(1);
});

test("the opt-in memory comparison reads through LiveStore without opening a dedicated worker", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class extends Worker {
      constructor() { throw new Error("The memory comparison must not start a dedicated worker"); }
    };
  });
  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance?paintDebug=1&readerStorage=memory");
  await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
});
