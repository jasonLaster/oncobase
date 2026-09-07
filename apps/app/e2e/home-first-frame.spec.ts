import { expect } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { documentArticle, installWikiApiMocks } from "./fixtures";

test("a home page without a heading paints from cache before application scripts run", async ({ page }) => {
  await installWikiApiMocks(page, {
    pageOverrides: { index: { content: "HOME_BODY_READY. A home page can start with a paragraph.\n\n[Open insurance](/wiki/logistics/insurance)" } },
  });
  await page.goto("/?scope=public", { waitUntil: "domcontentloaded" });
  await expect(documentArticle(page)).toContainText("HOME_BODY_READY");
  await expect(documentArticle(page).locator("h1")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith("wiki-vite:first-frame:"))
    .some(key => JSON.parse(localStorage.getItem(key)!).pathname === "/")), { timeout: 5000 }).toBe(true);

  let release!: () => void;
  const scriptsHeld = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await scriptsHeld;
    await route.fallback();
  });
  try {
    await page.reload({ waitUntil: "commit" });
    const snapshot = page.locator("#wiki-first-frame-snapshot");
    await expect(snapshot).toBeVisible();
    await expect(snapshot).toContainText("HOME_BODY_READY");
    await expect(snapshot.locator("h1")).toHaveCount(0);
    await expect(snapshot).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("#root")).toHaveCSS("visibility", "hidden");
  } finally {
    release();
  }
  await expect(documentArticle(page)).toContainText("HOME_BODY_READY");
  await expect(page.locator("html")).not.toHaveAttribute("data-wiki-first-frame", "true");
  await expect(page.locator("#root")).toHaveCSS("visibility", "visible");
});
