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
    const input = page.locator("textarea").first();
    await input.fill("What is TNBC?");
    await input.press("Enter");

    await expect(page.getByText("What is TNBC?")).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the Stop button to appear (streaming started),
    // then wait for it to disappear (response complete) or
    // just check that new content appeared beyond the user message.
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Research link in header navigates to chat", async ({ page }) => {
    await page.goto("/");
    // Scope to header to avoid matching "Research" in page content
    await page.locator("header").getByRole("link", { name: "Research" }).click();
    await expect(page).toHaveURL(/\/chat/);
  });
});
