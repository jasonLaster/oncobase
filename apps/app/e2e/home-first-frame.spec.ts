import { expect } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { documentArticle, installWikiApiMocks } from "./fixtures";
import { WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";

test("cold and refreshed home render only through React, ignoring old HTML snapshots", async ({ page }) => {
  await installWikiApiMocks(page, {
    pageOverrides: { index: { content: "HOME_BODY_READY. A home page can start with a paragraph." } },
  });
  await page.addInitScript(version => {
    localStorage.setItem(`wiki-vite:first-frame:${version}:${location.origin}`, JSON.stringify({
      pathname: "/", readerCacheVersion: version, validatedAt: Date.now(),
      html: '<aside data-test-id="wiki-sidebar">STALE_SIDEBAR</aside><article data-test-id="document-article"><h1>STALE_BODY</h1></article>',
    }));
  }, WIKI_READER_CACHE_VERSION);
  for (const reload of [false, true]) {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const holdScripts = async (route: import("@playwright/test").Route) => {
      if (route.request().resourceType() === "script") await held;
      await route.fallback();
    };
    await page.route("**/*", holdScripts);
    try {
      if (reload) await page.reload({ waitUntil: "commit" });
      else await page.goto("/?scope=public", { waitUntil: "commit" });
      await expect(page.locator("#root")).toHaveCount(1);
      await expect(page.locator("#root")).toBeEmpty();
      await expect(page.locator("#wiki-first-frame-snapshot, #wiki-html-first")).toHaveCount(0);
      await expect(page.getByText("STALE_BODY")).toHaveCount(0);
      await expect(page.locator("#root")).toHaveCSS("visibility", "visible");
      await page.keyboard.press("Meta+K");
    } finally { release(); }
    await expect(page.getByTestId("command-palette-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(documentArticle(page)).toContainText("HOME_BODY_READY");
    await expect(documentArticle(page).locator("h1")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("wiki-vite:first-frame:")))).toEqual([]);
    await page.unroute("**/*", holdScripts);
  }
});
