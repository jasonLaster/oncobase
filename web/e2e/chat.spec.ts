import { test, expect } from "@playwright/test";
import { mockChatApi } from "./chat-mock";
import { chatComposer, chatSubmitButton } from "./helpers";

test.describe("Chat", () => {
  let chatMock: Awaited<ReturnType<typeof mockChatApi>> | null = null;

  test.beforeEach(async ({ page }) => {
    chatMock = await mockChatApi(page);
    await page.goto("/chat");
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
    await expect(chatComposer(page)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("can send a message and get a response", async ({ page }) => {
    // Click the first suggested-prompt button on the empty state.
    await page.getByTestId("chat-suggested-prompt").first().click();

    await expect(page.getByTestId("chat-assistant-message")).toContainText("mocked chat response", {
      timeout: 15_000,
    });
    await expect(chatSubmitButton(page)).toHaveAccessibleName("Submit");
  });

  test("Ask wiki footer button navigates to chat", async ({ page }) => {
    await page.goto("/");
    const askWiki = page.getByTestId("sidebar-ask-wiki");
    await expect(askWiki).toBeVisible();
    await askWiki.click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 15_000 });
  });

  test("mobile header navigation opens page nav by default with an outline tab", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await page.getByTestId("bottom-nav-trigger").click();

    const sheet = page.getByTestId("bottom-nav-sheet");
    await expect(sheet.getByText("Page navigation", { exact: true })).toBeHidden();
    await expect(sheet.getByRole("button", { name: "Page nav" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Outline" })).toBeVisible();
    await expect(sheet.getByTestId("bottom-nav-page-tree")).toBeVisible();
  });
});
