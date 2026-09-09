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

for (const mobile of [false, true]) {
  test(`${mobile ? "phone" : "desktop"} Search keeps sign in and the account dialog contains keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: 900 });
    await installWikiApiMocks(page);
    await page.route("**/api/auth/session", route => route.fulfill({ json: { user: null } }));
    await page.goto("/");
    await expect(page.getByTestId("document-article")).toBeVisible();
    await page.getByTestId(mobile ? "mobile-header-search" : "sidebar-search").click();
    await expect(page.getByTestId("command-palette-input")).toBeFocused();
    await page.keyboard.press("Escape");
    if (mobile) await page.getByRole("button", { name: "Open page navigation", exact: true }).click();
    const prompt = page.getByTestId("sidebar-sign-in").filter({ visible: true });
    await prompt.click();
    const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
    await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Need an account? Sign up" })).toBeFocused();
    await dialog.getByRole("button", { name: "Need an account? Sign up" }).click();
    await expect(page.getByRole("dialog", { name: "Sign up", exact: true }).getByLabel("Name", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wiki-auth-dialog")).toHaveCount(0);
    await expect(prompt).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });
}
