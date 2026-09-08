import { test, expect } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

test("the initial sidebar sign-in destination opens a usable account dialog", async ({ page }) => {
  await installWikiApiMocks(page);
  await page.goto("/?html-first=off&reader-action=signin");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Sign in to your account");
  await expect(dialog.getByRole("textbox", { name: /email/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
