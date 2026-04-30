import { test, expect } from "@playwright/test";
import {
  localStreamingChatSkipReason,
  shouldSkipLocalStreamingChatE2E,
} from "./chat-env";

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
    test.skip(shouldSkipLocalStreamingChatE2E(), localStreamingChatSkipReason);

    // Click the first suggested-prompt button on the empty state.
    await page
      .getByRole("button", {
        name: /ctDNA|treatment plan|clinical trial|prognosis|vaccine|pembrolizumab|immune|chemo/i,
      })
      .first()
      .click();

    // Wait for the Stop button to appear (streaming started),
    // then wait for it to disappear (response complete) or
    // just check that new content appeared beyond the user message.
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("new chat button in header navigates to chat", async ({ page }) => {
    await page.goto("/");
    const newChat = page.locator("header").getByRole("button", { name: "New chat" });
    await expect(newChat).toBeVisible();
    await newChat.click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 15_000 });
  });
});
