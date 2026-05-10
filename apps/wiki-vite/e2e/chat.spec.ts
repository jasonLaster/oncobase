import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("Chat", () => {
  test("chat page loads the full composer UI", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("chat-page")).toBeVisible();
    await expect(page.getByTestId("conversation-list")).toBeVisible();
    await expect(page.getByTestId("chat-interface")).toBeVisible();
    await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
    await expect(page.getByTestId("chat-suggested-prompts")).toBeVisible();
  });

  test.skip("can send a message and get a response", async () => {
    // Requires AI Gateway credentials and durable Convex writes; covered by API validation locally.
  });

  test("new chat button in header navigates to chat", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("link", { name: "New Chat" }).click();

    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByTestId("chat-interface")).toBeVisible();
  });

  test.skip("mobile bottom sheet shows chat history navigation", async () => {
    // Mobile conversation navigation needs a dedicated layout pass once archived chat parity lands.
  });
});
