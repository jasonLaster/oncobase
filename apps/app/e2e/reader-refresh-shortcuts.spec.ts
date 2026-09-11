import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

for (const path of ["/", "/missing-reader-page"]) {
  for (const shortcut of ["Meta+O", "Meta+K", "Control+O", "Control+K"]) {
    test(`${shortcut} survives refreshing ${path} before application scripts load`, async ({ page }) => {
      await installWikiApiMocks(page);
      let pauseScripts = false;
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      // Route before the first visit so WebKit cannot serve refresh scripts
      // from an already populated memory cache without consulting the gate.
      await page.route("**/*", async route => {
        if (pauseScripts && route.request().resourceType() === "script") await held;
        await route.fallback();
      });
      if (path === "/") await gotoWiki(page, path);
      else {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: /Page not found|This page may be restricted/ })).toBeVisible();
      }
      try {
        pauseScripts = true;
        await page.reload({ waitUntil: "commit" });
        await expect(page.locator("#wiki-reader-shortcuts")).toHaveCount(1);
        await expect(page.locator("#root")).toBeEmpty();
        await page.keyboard.press(shortcut);
        // The chord can span the transition from inline listener to React.
        release();
        const input = page.getByTestId("command-palette-input");
        await expect(input).toBeFocused();
        await input.fill("insurance");
        await expect(page.getByRole("option").first()).toContainText("insurance");
        await input.press("Enter");
        await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
        await expect(input).toHaveCount(0);
        await page.keyboard.press(shortcut);
        await expect(input).toBeFocused();
        await input.press("Escape");
        await expect(input).toHaveCount(0);
      } finally { release(); }
    });
  }
}
