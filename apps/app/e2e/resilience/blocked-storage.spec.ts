import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "../fixtures";

// Safari private mode, blocked site data and sandboxed iframes make even
// reading `window.localStorage` throw. Every storage access goes through
// @oncobase/safe-storage, so the reader must keep working, never show the
// recovery card, and keep preferences in memory for the page.
async function blockWebStorage(page: Page) {
  await page.addInitScript(() => {
    const blocked = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, name, { get: blocked, configurable: true });
    }
  });
}

async function drag(page: Page, handle: Locator, deltaX: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle is not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX / 2, y, { steps: 4 });
  await page.mouse.move(x + deltaX, y, { steps: 4 });
  await page.mouse.up();
}

const widthOf = (locator: Locator) => locator.evaluate(element => element.getBoundingClientRect().width);

test("the reader opens, changes theme and resizes panels when every storage access throws", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await blockWebStorage(page);
  await installWikiApiMocks(page);

  await gotoWiki(page, "/");
  await waitForPageTitle(page, "Diana Wiki Home");
  expect(await page.evaluate(() => {
    try { void window.localStorage; return "readable"; } catch (error) { return (error as DOMException).name; }
  })).toBe("SecurityError");
  const recovery = page.getByTestId("app-recovery");
  await expect(recovery).toHaveCount(0);

  // Theme: System (light) -> Dark, held in memory because nothing can persist.
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);
  const actions = page.getByRole("button", { name: "Workspace menu" });
  await actions.click();
  await page.getByRole("menu", { name: "Actions" }).getByRole("menuitem", { name: /^Theme: System/ }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await actions.click();
  await expect(page.getByRole("menu", { name: "Actions" }).getByRole("menuitem", { name: /^Theme: Dark/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Left sidebar: the width comes from a useSyncExternalStore snapshot.
  const sidebarHandle = page.getByRole("separator", { name: "Resize sidebar" });
  const sidebar = page.locator("[data-sidebar-layout] .sidebar-expanded-rail");
  const sidebarBefore = await widthOf(sidebar);
  await drag(page, sidebarHandle, 80);
  await expect.poll(() => widthOf(sidebar)).toBeGreaterThan(sidebarBefore + 40);

  // Outline rail on the right, also a cached snapshot over storage.
  const outline = page.getByTestId("page-outline");
  const outlineHandle = page.getByRole("separator", { name: "Resize outline pane" });
  if (await outlineHandle.count() === 0) {
    await page.getByRole("button", { name: /^Open outline$/ }).click();
  }
  await expect(outlineHandle).toBeVisible();
  const outlineBefore = await widthOf(outline);
  await drag(page, outlineHandle, -60);
  await expect.poll(() => widthOf(outline)).toBeGreaterThan(outlineBefore + 30);

  // Client navigation still works, and nothing escalated to the recovery card.
  await documentArticle(page).getByRole("link", { name: "Insurance" }).click();
  await waitForPageTitle(page, "Insurance");
  await expect(recovery).toHaveCount(0);
  await expect(html).toHaveClass(/\bdark\b/);
  expect(pageErrors.filter(message => /storage|insecure/i.test(message))).toEqual([]);
});
