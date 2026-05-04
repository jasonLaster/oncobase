import type { Page, Route } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { resolveServerConvexUrl } from "../src/lib/convex-url";

type ChatRequestBody = {
  conversationId?: string;
  messages?: Array<{
    role?: string;
    parts?: Array<{ type?: string; text?: string }>;
    content?: string;
  }>;
};

const DEFAULT_SITE_SLUG = process.env.E2E_SITE_SLUG ?? "diana";

const RESPONSE_CACHE = new Map<string, string>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConvexClient() {
  const url = resolveServerConvexUrl();
  if (!url) {
    throw new Error(
      "Convex must point at a real deployment for chat E2E mocking."
    );
  }
  return new ConvexHttpClient(url);
}

function lastUserPrompt(body: ChatRequestBody) {
  const user = [...(body.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user");
  if (!user) return "";
  const textPart = user.parts?.find((part) => part.type === "text");
  return textPart?.text ?? user.content ?? "";
}

function cachedAnswerFor(prompt: string) {
  const key = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  const cached = RESPONSE_CACHE.get(key);
  if (cached) return cached;

  const answer = key.includes("keynote-522")
    ? "KEYNOTE-522 is a neoadjuvant pembrolizumab plus chemotherapy regimen studied for early-stage triple-negative breast cancer."
    : key.includes("prognosis")
      ? "Stage II TNBC prognosis depends on response to therapy, nodal status, tumor biology, and whether pathologic complete response is achieved."
      : "This mocked chat response is deterministic for E2E coverage and avoids spending AI Gateway credits.";

  RESPONSE_CACHE.set(key, answer);
  return answer;
}

function sseBody(messageId: string, text: string) {
  const textId = `${messageId}-text`;
  const chunks = [
    { type: "start", messageId },
    { type: "start-step" },
    { type: "text-start", id: textId },
    { type: "text-delta", id: textId, delta: text },
    { type: "text-end", id: textId },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop" },
  ];
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

async function saveMockAssistantMessage({
  body,
  responseText,
  siteSlug,
}: {
  body: ChatRequestBody;
  responseText: string;
  siteSlug: string;
}) {
  if (!body.conversationId) return;

  const convex = getConvexClient();
  const conversationId = body.conversationId as Id<"conversations">;
  await convex.mutation(api.conversations.saveMessages, {
    conversationId,
    siteSlug,
    messages: [
      {
        role: "assistant",
        content: responseText,
        parts: [{ type: "text", text: responseText }],
        createdAt: Date.now(),
        messageId: `e2e_mock_${crypto.randomUUID()}`,
      },
    ],
  });
  await convex.mutation(api.conversations.clearStreaming, {
    conversationId,
    siteSlug,
  });
}

export async function mockChatApi(page: Page, options?: { delayMs?: number }) {
  const conversationSiteSlugs = new Map<string, string>();
  const delayMs = options?.delayMs ?? 350;

  await page.route("**/api/chat", async (route: Route) => {
    const body = route.request().postDataJSON() as ChatRequestBody;
    const siteSlug =
      route.request().headers()["x-site-slug"] ?? DEFAULT_SITE_SLUG;
    if (body.conversationId) {
      conversationSiteSlugs.set(body.conversationId, siteSlug);
    }

    const responseText = cachedAnswerFor(lastUserPrompt(body));
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    await saveMockAssistantMessage({ body, responseText, siteSlug });

    try {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-vercel-ai-ui-message-stream": "v1",
          "x-accel-buffering": "no",
        },
        body: sseBody(
          `msg_e2e_${crypto.randomUUID().replaceAll("-", "")}`,
          responseText
        ),
      });
    } catch {
      // The user may have clicked Stop or navigated away while the mock was
      // delaying the response. The persisted Convex row is the important part
      // for the navigation-resilience assertions.
    }
  });

  return {
    async cleanup() {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (conversationSiteSlugs.size === 0) return;
      const convex = getConvexClient();
      await Promise.all(
        [...conversationSiteSlugs].map(([id, siteSlug]) =>
          convex.mutation(api.conversations.archive, {
            id: id as Id<"conversations">,
            siteSlug,
          })
        )
      );
    },
  };
}
