import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

test("initial HTML downloads reader modules before the entry can execute", async ({ page }) => {
  await installWikiApiMocks(page);
  const requested: string[] = [];
  page.on("request", request => requested.push(new URL(request.url()).pathname));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/assets/index-*.js", async route => { await held; await route.fallback(); });
  try {
    await page.goto("/wiki/logistics/insurance", { waitUntil: "commit" });
    await expect.poll(() => requested.some(path => /\/LiveStoreRoot-/.test(path))).toBe(true);
    await expect(page.getByTestId("app-starting")).toBeVisible();
    expect(requested.filter(path => /\/api\/wiki\/|vendor-math-|\.wasm$/.test(path))).toEqual([]);
    release();
    await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
    expect(requested.filter(path => /\/LiveStoreRoot-/.test(path))).toHaveLength(1);
  } finally { release(); }
});
