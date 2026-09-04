import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "getDirectory", {
      value: async () => { throw new DOMException("Storage denied", "UnknownError"); },
    });
  });
});

test("denied persistent storage still permits reading, navigation, and reload", async ({ page }) => {
  const errors: string[] = [];
  const captureError = (error: Error) => { errors.push(error.message); };
  page.on("pageerror", captureError);
  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
  await page.getByTestId("sidebar-search").click();
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  await page.getByTestId("command-palette-input").fill("terminology");
  await palette.getByRole("option", { name: /terminology/i }).first().click();
  await expect(page).toHaveURL(/\/about\/Terminology$/);
  await expect(page.getByTestId("document-article")).toContainText("BRCA");
  expect(errors).toEqual([]);
  // WebKit reports aborted background warm fetches as access-control errors
  // during unload. Check the mounted reader's errors before that teardown.
  page.off("pageerror", captureError);
  await page.reload();
  await expect(page.getByTestId("document-article")).toContainText("BRCA");
});

test("temporary reader storage keeps public and session content separate", async ({ page }) => {
  await installWikiApiMocks(page, { sessionAuthenticated: true });
  await gotoWiki(page, "/private/plan?scope=session");
  await expect(page.getByTestId("document-article")).toContainText("Sensitive session-only planning note");
  await gotoWiki(page, "/private/plan?scope=public");
  await expect(page.getByTestId("document-article").locator("h1")).toHaveText("Page not found");
  await expect(page.getByTestId("document-article")).not.toContainText("Sensitive session-only planning note");
  await page.getByTestId("sidebar-search").click();
  await page.getByTestId("command-palette-input").fill("private plan");
  await expect(page.getByText("No pages found")).toBeVisible();
});
