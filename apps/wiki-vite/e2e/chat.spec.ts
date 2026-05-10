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

    await expect(page.getByTestId("chat-page")).toBeVisible();
    await expect(page.getByTestId("conversation-list")).toBeVisible();
    await expect(page.getByTestId("chat-interface")).toBeVisible();
    await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
    await expect(page.getByTestId("chat-suggested-prompts")).toBeVisible();
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

    await page.getByRole("link", { name: "New Chat" }).click();

    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByTestId("chat-interface")).toBeVisible();
  });

  test.skip("mobile bottom sheet shows chat history navigation", async () => {
    // Mobile conversation navigation needs a dedicated layout pass once archived chat parity lands.
  });
});
