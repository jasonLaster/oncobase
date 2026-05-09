import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, openDirectory, waitForPageTitle } from "./fixtures";

async function openSourcePath(page: import("@playwright/test").Page) {
  await openDirectory(page, "institutions");
  await openDirectory(page, "stanford");
  await openDirectory(page, "telli");
}

test.describe("Sidebar source files", () => {
  test("sources directory contains markdown source links after drilling into stanford/telli", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openSourcePath(page);
    const sourceLink = page
      .getByTestId("wiki-sidebar")
      .locator('a[href="/sources/institutions/stanford/telli"]');
    await expect(sourceLink).toBeVisible();
    await expect(sourceLink).not.toHaveAttribute("href", /\/api\/file/);

    await sourceLink.click();
    await waitForPageTitle(page, "Telli 2016 HRD Platinum TNBC");
  });

  test("wiki/research-style pages are markdown links, not PDF links", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openDirectory(page, "examples");
    const tablePage = page
      .getByTestId("wiki-sidebar")
      .getByRole("link", { name: "smart table" });
    await expect(tablePage).toBeVisible();
    await expect(tablePage).not.toHaveAttribute("href", /\/api\/file/);
  });
});

test.describe("Sidebar PDF files", () => {
  test("sources directory contains PDF links after drilling into stanford/telli", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openSourcePath(page);
    const pdfLink = page.getByTestId("wiki-sidebar").locator('a[href*="/api/file?path="]').first();
    await expect(pdfLink).toBeVisible();
    await expect(pdfLink).toHaveAttribute("href", /\/api\/file\?path=.*\.pdf/);
    await expect(pdfLink).toHaveAttribute("target", "_blank");
    await expect(pdfLink.locator("svg")).toHaveCount(1);
  });

  test.skip("PDF serving via /api/file validates backend error cases", async () => {
    // `/api/file` is still served by the Next content API. The Vite migration
    // verifies PDF links and leaves backend path validation in the web suite.
  });
});
