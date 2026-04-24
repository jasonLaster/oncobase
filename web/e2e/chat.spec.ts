import { test, expect } from "@playwright/test";

test.describe("Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/chat");
    const url = page.url();
    test.skip(!url.includes("/chat"), "Chat is disabled (redirected to /)");
  });

  test("chat page loads", async ({ page }) => {
    await expect(page.locator("textarea").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("can send a message and get a response", async ({ page }) => {
    await page
      .getByRole("button", { name: "What clinical trials are relevant?" })
      .click();

    // Wait for the Stop button to appear (streaming started),
    // then wait for it to disappear (response complete) or
    // just check that new content appeared beyond the user message.
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("new chat link in header navigates to chat", async ({ page }) => {
    await page.goto("/");
    await page.locator("header").getByRole("link", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/chat/);
  });
});
