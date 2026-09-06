import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  viteErrorOverlay,
  waitForPageTitle,
} from "./fixtures";

test.describe("source loading boundary", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("wiki pages do not render a source document loading shell", async ({ page }) => {
    await gotoWiki(page, "/wiki/diagnostics/diagnosis");

    await waitForPageTitle(page, "Diagnosis");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    await expect(viteErrorOverlay(page)).toHaveCount(0);
  });

  test("source pages still render cleanly through their scoped route", async ({ page }) => {
    await gotoWiki(page, "/sources/people/providers/stanford/telli");

    await waitForPageTitle(page, "Telli 2016 HRD Platinum TNBC");
    await expect(documentArticle(page)).toContainText("source page proves source routes");
    await expect(viteErrorOverlay(page)).toHaveCount(0);
  });

  test("command palette Enter opens wiki results without the source loading shell", async ({ page }) => {
    await gotoWiki(page, "/sources/people/providers/stanford/telli");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.getByTestId("command-palette-input").fill("diagnosis");
    await page.getByTestId("command-palette-input").press("Enter");

    await expect(page).toHaveURL(/\/wiki\/diagnostics\/diagnosis$/);
    await waitForPageTitle(page, "Diagnosis");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    await expect(viteErrorOverlay(page)).toHaveCount(0);
  });
});
