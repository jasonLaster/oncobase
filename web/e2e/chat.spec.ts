import { test, expect } from "@playwright/test";
import { mockChatApi } from "./chat-mock";

test.describe("Chat", () => {
  let chatMock: Awaited<ReturnType<typeof mockChatApi>> | null = null;

  test.beforeEach(async ({ page }) => {
    chatMock = await mockChatApi(page);
    await page.goto("/chat");
    await page.waitForLoadState("networkidle").catch(() => {});
    test.skip(
      !new URL(page.url()).pathname.startsWith("/chat"),
      "Chat is disabled (redirected to /)"
    );
  });

  test.afterEach(async () => {
    await chatMock?.cleanup();
    chatMock = null;
  });

  test("chat page loads", async ({ page }) => {
    await expect(page.locator("textarea").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("can send a message and get a response", async ({ page }) => {
    // Click the first suggested-prompt button on the empty state.
    await page
      .getByRole("button", {
        name: /ctDNA|treatment plan|clinical trial|prognosis|vaccine|pembrolizumab|immune|chemo/i,
      })
      .first()
      .click();

    await expect(page.getByText("mocked chat response", { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();
  });

  test("new chat button in header navigates to chat", async ({ page }) => {
    await page.goto("/");
    const newChat = page.locator("header").getByRole("button", { name: "New chat" });
    await expect(newChat).toBeVisible();
    await newChat.click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 15_000 });
  });
});
