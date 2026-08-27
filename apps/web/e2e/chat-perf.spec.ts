import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { gotoChatOrSkip } from "./helpers";
import { mockChatApi } from "./chat-mock";
import { expect, test } from "./fixtures";
import { testConvexUrl } from "./test-environment";

const TTFB_BUDGET_MS = 2_500;
const TOTAL_BUDGET_MS = 5_000;
const UI_COMPLETION_TIMEOUT_MS = 30_000;
const convexUrl = testConvexUrl();

interface PerfSample {
  scenario: string;
  ttfbMs: number | null;
  totalMs: number | null;
  events: number;
  eventTypes: string[];
  capturedAt: string;
}

async function setup(
  page: import("@playwright/test").Page,
  conversationId: Id<"conversations">,
) {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_PERF__?: unknown }).__CHAT_PERF__ = {
      events: [],
      push(e: unknown) {
        (this as { events: unknown[] }).events.push(e);
      },
      drain() {
        const copy = (this as { events: unknown[] }).events.slice();
        (this as { events: unknown[] }).events = [];
        return copy;
      },
      clear() {
        (this as { events: unknown[] }).events = [];
      },
    };
  });
  const chatMock = await mockChatApi(page, { delayMs: 350 });
  await gotoChatOrSkip(page, `/chat/${conversationId}`);
  return chatMock;
}

async function readPerf(
  page: import("@playwright/test").Page,
  scenario: string,
): Promise<PerfSample> {
  const raw = await page.evaluate(() => {
    const buffer = (
      window as unknown as {
        __CHAT_PERF__?: {
          events: Array<{
            type: string;
            t: number;
            latencyMs?: number;
            totalMs?: number;
          }>;
        };
      }
    ).__CHAT_PERF__;
    return buffer?.events ?? [];
  });
  const firstToken = raw.find((event) => event.type === "first-token");
  const streamEnd = raw.find((event) => event.type === "stream-end");
  return {
    scenario,
    ttfbMs: firstToken?.latencyMs ?? null,
    totalMs: streamEnd?.totalMs ?? null,
    events: raw.length,
    eventTypes: raw.map((event) => event.type),
    capturedAt: new Date().toISOString(),
  };
}

test.describe("@performance Chat perf", () => {
  test.skip(
    !convexUrl,
    "Chat performance tests require PLAYWRIGHT_TEST_CONVEX_URL.",
  );

  let chatMock: Awaited<ReturnType<typeof mockChatApi>> | null = null;
  let conversationId: Id<"conversations"> | null = null;
  let convex: ConvexHttpClient | null = null;

  test.beforeAll(async () => {
    convex = new ConvexHttpClient(convexUrl!);
    await convex.mutation(api.sites.ensureDiana, { domain: "localhost" });
  });

  test.beforeEach(async ({ page }) => {
    conversationId = await convex!.mutation(api.conversations.create, {
      siteSlug: "diana",
      title: "E2E performance sample",
    });
    await convex!.mutation(api.conversations.saveMessages, {
      conversationId,
      siteSlug: "diana",
      messages: [
        {
          role: "user",
          content: "What is TNBC?",
          parts: [{ type: "text", text: "What is TNBC?" }],
          createdAt: Date.now(),
          messageId: `e2e_perf_${crypto.randomUUID()}`,
        },
      ],
    });
    chatMock = await setup(page, conversationId);
  });

  test.afterEach(async () => {
    await chatMock?.cleanup();
    if (conversationId) {
      await convex!.mutation(api.conversations.remove, {
        id: conversationId,
        siteSlug: "diana",
      });
    }
    chatMock = null;
    conversationId = null;
  });

  test("short mocked response emits complete telemetry within budget", async ({
    page,
  }) => {
    await expect(page.getByTestId("chat-assistant-message")).toContainText(
      "mocked chat response",
      { timeout: UI_COMPLETION_TIMEOUT_MS },
    );

    const sample = await readPerf(page, "P0-A");
    console.log(`[chat-perf] ${JSON.stringify(sample)}`);

    expect(sample.eventTypes).toContain("first-token");
    expect(sample.eventTypes).toContain("stream-end");
    expect(sample.events).toBeGreaterThanOrEqual(2);
    expect(sample.ttfbMs).not.toBeNull();
    expect(sample.totalMs).not.toBeNull();
    expect(sample.ttfbMs!).toBeLessThanOrEqual(TTFB_BUDGET_MS);
    expect(sample.totalMs!).toBeLessThanOrEqual(TOTAL_BUDGET_MS);
    expect(sample.totalMs!).toBeGreaterThanOrEqual(sample.ttfbMs!);
  });
});
