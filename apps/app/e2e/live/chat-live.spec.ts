import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ensurePasswordGateSession } from "../gate-auth";

// Opt-in nightly check against the REAL model (excluded from the default
// Playwright run by playwright.config.ts testIgnore). The deterministic chat
// journeys live in e2e/journeys/chat.spec.ts and use the fake model.
//
//   AI_GATEWAY_API_KEY=... NEXT_PUBLIC_CONVEX_URL=... bunx playwright test e2e/live/chat-live.spec.ts
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.VITE_CONVEX_URL;
const archiveConversation = makeFunctionReference<"mutation", { id: string; siteSlug?: string }>(
  "conversations:archive",
);

test("a real model answers a chat message and the reply persists", async ({ page }) => {
  test.skip(
    !process.env.AI_GATEWAY_API_KEY || !convexUrl,
    "Requires AI_GATEWAY_API_KEY and a Convex URL",
  );

  const chat = page.getByTestId("chat-interface");
  let conversationId: string | null = null;
  try {
    await ensurePasswordGateSession(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chat-composer-textarea").fill("Reply with exactly: pong");
    await page.getByTestId("chat-submit-button").click();
    await expect(chat).toHaveAttribute("data-chat-conversation-id", /^(?!new$).+/, { timeout: 15_000 });
    conversationId = await chat.getAttribute("data-chat-conversation-id");
    await expect(page.getByTestId("chat-assistant-message").last()).toContainText(/pong/i, {
      timeout: 60_000,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-assistant-message").last()).toContainText(/pong/i, {
      timeout: 30_000,
    });
  } finally {
    if (conversationId && convexUrl) {
      await new ConvexHttpClient(convexUrl)
        .mutation(archiveConversation, { id: conversationId, siteSlug: "diana" })
        .catch(() => {});
    }
  }
});
