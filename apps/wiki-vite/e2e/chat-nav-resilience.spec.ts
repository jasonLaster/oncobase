import { expect, test, type Locator, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const hasAiGateway = Boolean(process.env.AI_GATEWAY_API_KEY);
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.VITE_CONVEX_URL;

const archiveConversation = makeFunctionReference<
  "mutation",
  { id: string; siteSlug?: string }
>("conversations:archive");
const getCancelState = makeFunctionReference<
  "query",
  { conversationId: string; siteSlug?: string },
  { canceledAt?: number; streamingText?: string; activeRunId?: string } | null
>("conversations:getCancelState");

async function currentConversationId(chat: Locator) {
  await expect(chat).toHaveAttribute("data-chat-conversation-id", /^(?!new$).+/, {
    timeout: 15_000,
  });
  return (await chat.getAttribute("data-chat-conversation-id"))!;
}

async function archiveIfPossible(conversationId: string | null) {
  if (!conversationId || conversationId === "new" || !convexUrl) return;
  const convex = new ConvexHttpClient(convexUrl);
  await convex
    .mutation(archiveConversation, {
      id: conversationId,
      siteSlug: "diana",
    })
    .catch(() => {});
}

async function submitPrompt(page: Page, prompt: string) {
  await page.getByTestId("chat-composer-textarea").fill(prompt);
  await page.getByTestId("chat-submit-button").click();
  return page.getByTestId("chat-interface");
}

test.describe("P0 chat navigation resilience", () => {
  test("Stop button aborts the model server-side", async ({ page }) => {
    test.skip(!hasAiGateway || !convexUrl, "Stop abort coverage requires AI_GATEWAY_API_KEY and Convex URL");

    let conversationId: string | null = null;
    try {
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      const chat = await submitPrompt(
        page,
        "Write a detailed TNBC wiki migration checklist with at least 12 bullets.",
      );
      conversationId = await currentConversationId(chat);

      await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: "Stop" }).click();

      await expect(chat).toHaveAttribute("data-chat-status", /ready|error/, {
        timeout: 15_000,
      });
      const convex = new ConvexHttpClient(convexUrl!);
      await expect
        .poll(
          async () => {
            const state = await convex.query(getCancelState, {
              conversationId: conversationId!,
              siteSlug: "diana",
            });
            return typeof state?.canceledAt === "number";
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    } finally {
      await archiveIfPossible(conversationId);
    }
  });

  test("Submit + navigate away + return shows the assistant message", async ({ page }) => {
    test.skip(!hasAiGateway || !convexUrl, "Navigation resilience requires AI_GATEWAY_API_KEY and Convex URL");

    let conversationId: string | null = null;
    try {
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      const chat = await submitPrompt(
        page,
        "Reply with exactly: navigation-resilience-ok",
      );
      conversationId = await currentConversationId(chat);

      await page.goto("/chat/archived", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("chat-archived-page")).toBeVisible();

      await page.goto(`/chat/${conversationId}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("chat-message-log")).toContainText(
        /navigation-resilience-ok/i,
        { timeout: 60_000 },
      );
    } finally {
      await archiveIfPossible(conversationId);
    }
  });

  test("Refresh mid-stream keeps the conversation observable", async ({ page }) => {
    test.skip(!hasAiGateway || !convexUrl, "Refresh resilience requires AI_GATEWAY_API_KEY and Convex URL");

    let conversationId: string | null = null;
    try {
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      const chat = await submitPrompt(
        page,
        "Reply with exactly: refresh-resilience-ok",
      );
      conversationId = await currentConversationId(chat);

      await page.reload({ waitUntil: "domcontentloaded" });

      const reloadedChat = page.getByTestId("chat-interface");
      await expect(reloadedChat).toHaveAttribute(
        "data-chat-conversation-id",
        conversationId,
      );
      await expect(page.getByTestId("chat-message-log")).toContainText(
        /refresh-resilience-ok/i,
        { timeout: 60_000 },
      );
    } finally {
      await archiveIfPossible(conversationId);
    }
  });

  test("Failed streams clear streaming state and keep the conversation recoverable", async ({ page }) => {
    test.skip(!convexUrl, "Failed-stream recovery requires Convex URL");

    let conversationId: string | null = null;
    let chatCalls = 0;
    await page.route("**/api/chat", async (route) => {
      chatCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced stream failure" }),
      });
    });

    try {
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      const chat = await submitPrompt(page, "Trigger a forced stream failure");
      conversationId = await currentConversationId(chat);

      await expect(page.getByTestId("chat-error")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("chat-error-retry")).toBeVisible();
      await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();

      await page.getByTestId("chat-error-retry").click();
      await expect.poll(() => chatCalls).toBe(2);
      await expect(page.getByTestId("chat-error")).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId("chat-error-dismiss").click();
      await expect(page.getByTestId("chat-error")).toBeHidden();
    } finally {
      await page.unroute("**/api/chat").catch(() => {});
      await archiveIfPossible(conversationId);
    }
  });
});
