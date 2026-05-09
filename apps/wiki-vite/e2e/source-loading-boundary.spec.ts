import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  nextErrorOverlay,
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
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("source pages still render cleanly through their scoped route", async ({ page }) => {
    await gotoWiki(page, "/sources/institutions/stanford/telli");

    await waitForPageTitle(page, "Telli 2016 HRD Platinum TNBC");
    await expect(documentArticle(page)).toContainText("source page proves source routes");
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test.skip("source route shell includes the streamed Next loading state", async () => {
    // The Vite reader does not stream server HTML; it shows its own local cache
    // shell while markdown is fetched.
  });

  test.skip("command palette Enter opens wiki results without the source loading shell", async () => {
    // Full command-palette parity is not implemented in the Vite reader yet.
  });
});
