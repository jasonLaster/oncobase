import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

const hasAiGateway = Boolean(process.env.AI_GATEWAY_API_KEY);
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.VITE_CONVEX_URL;
const archiveConversation = makeFunctionReference<
  "mutation",
  { id: string; siteSlug?: string }
>("conversations:archive");

test.describe("Chat", () => {
  test("chat page loads the full composer UI", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    const desktopChat = page.getByTestId("chat-page");

    await expect(desktopChat).toBeVisible();
    await expect(desktopChat.getByTestId("conversation-list")).toBeVisible();
    await expect(desktopChat.getByTestId("conversation-list-archived")).toBeVisible();
    await expect(page.getByTestId("chat-interface")).toBeVisible();
    await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
    await expect(page.getByTestId("chat-suggested-prompts")).toBeVisible();
  });

  test("conversation list uses shared archived navigation", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await page.getByTestId("chat-page").getByTestId("conversation-list-archived").click();

    await expect(page).toHaveURL(/\/chat\/archived$/);
    await expect(page.getByTestId("chat-archived-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Archived Chats" })).toBeVisible();
  });

  test("can send a message and get a response", async ({ page }) => {
    test.skip(!hasAiGateway || !convexUrl, "Live chat UI smoke requires AI_GATEWAY_API_KEY and Convex URL");

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chat-composer-textarea").fill("Reply with exactly: pong");
    await page.getByTestId("chat-submit-button").click();

    const chat = page.getByTestId("chat-interface");
    await expect(chat).toHaveAttribute("data-chat-conversation-id", /.+/, { timeout: 15_000 });
    await expect(page.getByTestId("chat-message-log")).toContainText(/pong/i, {
      timeout: 60_000,
    });

    await expect(page).toHaveURL(/\/chat\/.+/);
    const conversationId = await chat.getAttribute("data-chat-conversation-id");
    if (conversationId && conversationId !== "new") {
      const convex = new ConvexHttpClient(convexUrl!);
      await convex.mutation(archiveConversation, {
        id: conversationId,
        siteSlug: "diana",
      });
    }
  });

  test("new chat button in header navigates to chat", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("link", { name: "New chat" }).click();

    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByTestId("chat-interface")).toBeVisible();
  });

  test("mobile bottom sheet shows chat history navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("bottom-nav-trigger")).toContainText("Chat with wiki");
    await page.getByTestId("bottom-nav-trigger").click();

    await expect(page.getByTestId("bottom-nav-sheet")).toHaveClass(/open/);
    const mobileChatList = page.getByTestId("bottom-nav-chat-list");
    await expect(mobileChatList).toBeVisible();
    await expect(mobileChatList.getByTestId("conversation-list-new-chat")).toBeVisible();
    await expect(mobileChatList.getByTestId("conversation-list-archived")).toBeVisible();
  });
});
