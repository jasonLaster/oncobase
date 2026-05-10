import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

test.describe("Session scope recovery", () => {
  test("session identity failure can fall back to the public store", async ({ page }) => {
    await installWikiApiMocks(page);
    await page.goto("/wiki/logistics/insurance?scope=session", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("session-recovery")).toBeVisible();
    await expect(page.getByText("Session access needed")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open sign in" })).toHaveAttribute(
      "href",
      /\/login$/,
    );

    await page.getByRole("button", { name: "Continue public" }).click();

    await expect(page).toHaveURL(/scope=public/);
    await waitForPageTitle(page, "Insurance");
    await expect(page.getByTestId("scope-switcher").getByText("Public")).toBeVisible();
  });

  test("header scope switcher preserves the current route", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/wiki/logistics/insurance?scope=session");

    const switcher = page.getByTestId("scope-switcher");
    await expect(switcher.getByText("Session")).toBeVisible();
    await expect(switcher.getByRole("link", { name: "Public" })).toHaveAttribute(
      "href",
      /\/wiki\/logistics\/insurance\?scope=public$/,
    );
  });
});
