import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("LiveStore devtools footer", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("keeps diagnostics footer hidden by default", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(page.getByTestId("livestore-devtools-footer")).toHaveCount(0);
    await expect(page.getByTestId("metrics-panel")).toHaveCount(0);
  });

  test("shows diagnostics footer only with the devtools query param", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    const footer = page.getByTestId("livestore-devtools-footer");
    await expect(footer).toContainText("devtools on");
    await expect(footer).toContainText("manifest");
    await expect(footer).toContainText("sync");

    await expect(footer.getByRole("button", { name: "Reset cache" })).toBeVisible();
    await expect(footer.getByRole("button", { name: "Warm cache" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Open devtools" })).toBeVisible();
  });

  test("exposes the devtools route only after opt-in", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    const footer = page.getByTestId("livestore-devtools-footer");
    await expect(footer).toContainText("devtools on");

    await expect(footer.getByRole("link", { name: "Open devtools" })).toHaveAttribute(
      "href",
      "/_livestore",
    );
    await expect(footer.getByRole("button", { name: "Disable" })).toBeVisible();
  });

  test("reset cache clears local state and reloads the reader", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    const footer = page.getByTestId("livestore-devtools-footer");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Clear the local LiveStore cache");
      await dialog.accept();
    });
    await footer.getByRole("button", { name: "Reset cache" }).click();

    await expect(page.getByTestId("document-article").locator(".page-header h1")).toHaveText(
      "Insurance",
    );
  });

  test("warm cache control can queue eager markdown fetches", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    const footer = page.getByTestId("livestore-devtools-footer");
    await footer.getByRole("button", { name: "Warm cache" }).click();

    await expect(footer).toContainText(/Warming|Queued/);
  });
});
