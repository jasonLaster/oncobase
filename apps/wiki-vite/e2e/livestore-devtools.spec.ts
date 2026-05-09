import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("LiveStore devtools footer", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("keeps devtools collapsed and disabled by default", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const footer = page.getByTestId("livestore-devtools-footer");
    await expect(footer).toContainText("devtools off");
    await expect(footer.getByRole("button", { name: "Enable" })).toHaveCount(0);

    await footer.locator("summary").click();

    await expect(footer.getByText("Enable to attach the local cache session.")).toBeVisible();
    await expect(footer.getByRole("button", { name: "Enable" })).toBeVisible();
    await expect(footer.getByRole("button", { name: "Reset cache" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Open devtools" })).toHaveCount(0);
  });

  test("exposes the devtools route only after opt-in", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance?livestoreDevtools=1");

    const footer = page.getByTestId("livestore-devtools-footer");
    await expect(footer).toContainText("devtools on");

    await footer.locator("summary").click();

    await expect(footer.getByRole("link", { name: "Open devtools" })).toHaveAttribute(
      "href",
      "/_livestore",
    );
    await expect(footer.getByRole("button", { name: "Disable" })).toBeVisible();
  });

  test("reset cache clears local state and reloads the reader", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const footer = page.getByTestId("livestore-devtools-footer");
    await footer.locator("summary").click();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Clear the local LiveStore cache");
      await dialog.accept();
    });
    await footer.getByRole("button", { name: "Reset cache" }).click();

    await expect(page.getByTestId("document-article").locator(".page-header h1")).toHaveText(
      "Insurance",
    );
  });
});
