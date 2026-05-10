import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

test.describe("Command palette parity", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("palette trigger opens local page navigation", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.getByTestId("command-palette-trigger").click();
    await page.getByTestId("command-palette-input").fill("about");
    await page.getByRole("button", { name: /About This Wiki/ }).click();

    await expect(page).toHaveURL(/\/about\/About$/);
    await waitForPageTitle(page, "About This Wiki");
  });

  test("outline palette jumps to headings rendered from markdown", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+O" : "Control+Shift+O");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByRole("button", { name: "Outline" }).click();
    await page
      .getByTestId("command-palette")
      .getByRole("button", { name: /Claims follow-up/ })
      .click();

    await expect(page).toHaveURL(/#claims-follow-up$/);
  });

  test("action palette keeps backend-owned features as backend links", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.getByRole("link", { name: /Search wiki/ })).toHaveAttribute("href", /\/search$/);
    await expect(page.getByRole("link", { name: /New chat/ })).toHaveAttribute("href", /\/chat$/);
    await expect(page.getByRole("link", { name: /Download full wiki/ })).toHaveAttribute(
      "href",
      /\/api\/download\?type=full$/,
    );
  });
});
