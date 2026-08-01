import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { gotoWiki, installWikiApiMocks } from "./fixtures";
import { ensurePasswordGateSession } from "./gate-auth";

const hasAiGateway = Boolean(process.env.AI_GATEWAY_API_KEY);
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.VITE_CONVEX_URL;
const archiveConversation = makeFunctionReference<
  "mutation",
  { id: string; siteSlug?: string }
>("conversations:archive");

async function archiveIfPossible(conversationId: string | null) {
  if (!conversationId || !convexUrl) return;
  const convex = new ConvexHttpClient(convexUrl);
  await convex
    .mutation(archiveConversation, {
      id: conversationId,
      siteSlug: "diana",
    })
    .catch(() => {});
}

test.describe("Chat", () => {
  test("chat page loads the full composer UI", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    const desktopChat = page.getByTestId("chat-page");
    const chatSidebar = page.getByTestId("chat-sidebar");

    await expect(desktopChat).toBeVisible();
    await expect(chatSidebar).toBeVisible();
    await expect(chatSidebar.getByTestId("conversation-list")).toBeVisible();
    await expect(chatSidebar.getByTestId("conversation-list-archived")).toBeVisible();
    await expect(desktopChat.getByTestId("conversation-list")).toHaveCount(0);
    // The mobile chat sheet keeps a second (hidden) list in the DOM; exactly
    // one conversation list may be visible.
    await expect(page.locator('[data-test-id="conversation-list"]:visible')).toHaveCount(1);
    await expect(page.getByTestId("chat-interface")).toBeVisible();
    await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
    await expect(page.getByTestId("chat-suggested-prompts")).toBeVisible();
  });

  test("conversation list uses shared archived navigation", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await page.getByTestId("chat-sidebar").getByTestId("conversation-list-archived").click();

    await expect(page).toHaveURL(/\/chat\/archived$/);
    await expect(page.getByTestId("chat-archived-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Archived Chats" })).toBeVisible();
  });

  test("can send a message and get a response", async ({ page }) => {
    test.skip(!hasAiGateway || !convexUrl, "Live chat UI smoke requires AI_GATEWAY_API_KEY and Convex URL");

    await ensurePasswordGateSession(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chat-composer-textarea").fill("Reply with exactly: pong");
    await page.getByTestId("chat-submit-button").click();

    const chat = page.getByTestId("chat-interface");
    await expect(chat).toHaveAttribute("data-chat-conversation-id", /.+/, { timeout: 15_000 });
    await expect(page.getByTestId("chat-assistant-message").last()).toContainText(/pong/i, {
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

  test("archiving the active conversation resets the new-chat surface", async ({
    page,
  }) => {
    test.skip(
      !hasAiGateway || !convexUrl,
      "Active archive coverage requires AI_GATEWAY_API_KEY and Convex URL",
    );

    let conversationId: string | null = null;
    const prompt = `Reply with exactly: archive-reset-${Date.now()}`;
    try {
      await ensurePasswordGateSession(page);
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      await page.getByTestId("chat-composer-textarea").fill(prompt);
      await page.getByTestId("chat-submit-button").click();

      const chat = page.getByTestId("chat-interface");
      await expect(chat).toHaveAttribute("data-chat-conversation-id", /^(?!new$).+/, {
        timeout: 15_000,
      });
      conversationId = await chat.getAttribute("data-chat-conversation-id");
      await expect(page.getByTestId("chat-assistant-message").last()).toContainText(
        /archive-reset-/,
        { timeout: 60_000 },
      );

      const activeItem = page
        .getByTestId("chat-sidebar")
        .locator(`[data-conversation-id="${conversationId}"]`);
      await activeItem.locator("..").getByRole("button", {
        name: "Conversation actions",
      }).click();
      await page.getByRole("button", { name: "Archive", exact: true }).click();

      await expect(page).toHaveURL(/\/chat$/);
      await expect(page.getByTestId("chat-interface")).toHaveAttribute(
        "data-chat-conversation-id",
        "new",
      );
      await expect(page.getByTestId("chat-interface")).not.toContainText(prompt);
      await expect(page.getByTestId("chat-suggested-prompts")).toBeVisible();
      conversationId = null;
    } finally {
      await archiveIfPossible(conversationId);
    }
  });

  test("sidebar ask wiki navigates to chat", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");
    await page.evaluate(() => {
      document.documentElement.dataset.navigationProbe = "alive";
    });

    await page.getByTestId("sidebar-ask-wiki").click();

    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByTestId("chat-interface")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.navigationProbe))
      .toBe("alive");
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

  test("mobile chat layout hides the desktop conversation sidebar and gives main full width", async ({ page }) => {
    const viewport = { width: 390, height: 844 };
    await page.setViewportSize(viewport);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-interface")).toBeVisible();

    await expect(page.getByTestId("chat-sidebar")).toBeHidden();
    await expect(page.locator(".wiki-shell-chat-sidebar")).toHaveCount(0);

    const main = page.locator(".wiki-shell-chat-main").first();
    const mainWidth = await main.evaluate((element) => element.getBoundingClientRect().width);
    expect(mainWidth).toBeGreaterThan(viewport.width - 24);

    await expect(page.getByTestId("bottom-nav-trigger")).toBeVisible();
  });
});
