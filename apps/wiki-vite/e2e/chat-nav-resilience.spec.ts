import { expect, test, type Locator, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ensurePasswordGateSession } from "./gate-auth";

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
  test("Stop before server startup survives a delayed HTTP request", async ({ page }) => {
    test.skip(!hasAiGateway || !convexUrl, "Startup cancellation requires the deployed chat backend");
    let conversationId: string | null = null;
    let requestBody: Record<string, unknown> | undefined;
    await page.route("**/api/chat", async (route) => {
      requestBody = route.request().postDataJSON();
      // Stop is exercised before any HTTP handler sees the request. Replaying
      // it through APIRequestContext below models delayed server startup without
      // relying on the disconnected browser fetch's AbortSignal propagation.
      await route.abort();
    });
    try {
      await ensurePasswordGateSession(page);
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      const chat = await submitPrompt(page, "QA delayed cancellation control");
      conversationId = await currentConversationId(chat);
      await expect.poll(() => Boolean(requestBody)).toBe(true);
      const convex = new ConvexHttpClient(convexUrl!);
      await convex.mutation(makeFunctionReference<"mutation">("conversations:cancelStream"), {
        conversationId, siteSlug: "diana",
      });
      const response = await page.request.post("/api/chat", {
        data: { ...requestBody, cancelResetHandled: true }, timeout: 20_000,
      });
      expect(response.status()).toBe(204);
      expect(requestBody?.cancelResetHandled).toBe(true);
      const state = await convex.query(getCancelState, { conversationId, siteSlug: "diana" });
      expect(typeof state?.canceledAt).toBe("number");
      expect(state?.activeRunId).toBeUndefined();
    } finally {
      await archiveIfPossible(conversationId);
    }
  });

  test("a new prompt resets the previous Stop before sending HTTP", async ({ page }) => {
    test.skip(!convexUrl, "Cancellation reset requires Convex URL");
    let conversationId: string | null = null;
    const requests: Array<Record<string, unknown>> = [];
    // Keep each request pending until the real Stop button aborts it.
    await page.route("**/api/chat", (route) => { requests.push(route.request().postDataJSON()); });
    try {
      await ensurePasswordGateSession(page);
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      const convex = new ConvexHttpClient(convexUrl!);
      for (let run = 1; run <= 2; run += 1) {
        const chat = await submitPrompt(page, `QA cancellation reset control ${run}`);
        conversationId = await currentConversationId(chat);
        await expect.poll(() => requests.length).toBe(run);
        await expect(page.getByTestId("chat-user-message")).toHaveCount(run);
        const state = await convex.query(getCancelState, { conversationId, siteSlug: "diana" });
        expect(state?.canceledAt).toBeUndefined();
        await page.getByRole("button", { name: "Stop" }).click();
        await expect(chat).toHaveAttribute("data-chat-status", /ready|error/);
        await expect.poll(async () => typeof (await convex.query(getCancelState, {
          conversationId: conversationId!, siteSlug: "diana",
        }))?.canceledAt).toBe("number");
      }
      expect(requests.every((request) => request.cancelResetHandled === true)).toBe(true);
    } finally {
      await archiveIfPossible(conversationId);
    }
  });

  test("Stop persists the disabled user message and does not auto-resume on reload", async ({ page }) => {
    test.skip(!convexUrl, "Persisted Stop requires Convex URL");
    let conversationId: string | null = null;
    let chatCalls = 0;
    await page.route("**/api/chat", () => { chatCalls += 1; });
    try {
      await ensurePasswordGateSession(page);
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      const chat = await submitPrompt(page, "QA stopped-message persistence control");
      conversationId = await currentConversationId(chat);
      await expect.poll(() => chatCalls).toBe(1);
      await page.getByRole("button", { name: "Stop" }).click();
      const convex = new ConvexHttpClient(convexUrl!);
      await expect.poll(async () => {
        const messages = await convex.query(makeFunctionReference<"query">("conversations:getMessages"), {
          id: conversationId!, siteSlug: "diana",
        }) as Array<{ role: string; disabled?: boolean }>;
        return messages.filter((message) => message.role === "user").at(-1)?.disabled;
      }).toBe(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("chat-message-log")).toContainText("QA stopped-message persistence control");
      await expect(page.getByTestId("chat-interface")).toHaveAttribute("data-chat-status", "ready");
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
      expect(chatCalls).toBe(1);
    } finally {
      await archiveIfPossible(conversationId);
    }
  });

  test("Stop button aborts the model server-side", async ({ page }) => {
    test.skip(!hasAiGateway || !convexUrl, "Stop abort coverage requires AI_GATEWAY_API_KEY and Convex URL");

    let conversationId: string | null = null;
    try {
      await ensurePasswordGateSession(page);
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
      await ensurePasswordGateSession(page);
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
      await ensurePasswordGateSession(page);
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
      await ensurePasswordGateSession(page);
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
