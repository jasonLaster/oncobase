import { expect, test } from "@playwright/test";

const hasAiGateway = Boolean(process.env.AI_GATEWAY_API_KEY);
const hasConvex = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.VITE_CONVEX_URL);

declare global {
  interface Window {
    __CHAT_PERF__?: {
      events: Array<{ type: string; [key: string]: unknown }>;
      push: (event: { type: string; [key: string]: unknown }) => void;
      drain: () => Array<{ type: string; [key: string]: unknown }>;
      clear: () => void;
    };
    __WIKI_VITE_OBSERVABILITY__?: {
      chat?: { eventCount: number };
      runtime?: { mode: string };
    };
  }
}

test.describe("P0 chat perf", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__CHAT_PERF__ = {
        events: [],
        push(event) {
          this.events.push(event);
        },
        drain() {
          const copy = this.events.slice();
          this.events.length = 0;
          return copy;
        },
        clear() {
          this.events.length = 0;
        },
      };
    });
  });

  test("P0-A composer accepts input", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await page.getByTestId("chat-composer-textarea").fill("What should I review today?");

    await expect(page.getByTestId("chat-composer-textarea")).toHaveValue("What should I review today?");
    await expect(page.getByTestId("chat-submit-button")).toBeEnabled();
  });

  test("P0-G perf buffer is exposed", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const shape = await page.evaluate(() => ({
      events: Array.isArray(window.__CHAT_PERF__?.events),
      push: typeof window.__CHAT_PERF__?.push,
      drain: typeof window.__CHAT_PERF__?.drain,
      clear: typeof window.__CHAT_PERF__?.clear,
    }));

    expect(shape).toEqual({
      events: true,
      push: "function",
      drain: "function",
      clear: "function",
    });
  });

  test("chat perf is mirrored into wiki observability", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await page.evaluate(() => {
      window.__CHAT_PERF__?.push({
        type: "submit",
        t: 1,
        conversationId: "test-conversation",
      });
    });

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__WIKI_VITE_OBSERVABILITY__?.chat?.eventCount ?? 0,
        ),
      )
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__WIKI_VITE_OBSERVABILITY__?.runtime?.mode ?? "",
        ),
      )
      .not.toBe("");
  });

  test("first-token and full-completion timings are recorded", async ({ page }) => {
    test.skip(!hasAiGateway || !hasConvex, "Live timing smoke requires AI Gateway and Convex credentials");

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chat-composer-textarea").fill("Reply with exactly: pong");
    await page.getByTestId("chat-submit-button").click();

    await expect(page.getByTestId("chat-message-log")).toContainText(/pong/i, {
      timeout: 60_000,
    });

    await expect.poll(
      () => page.evaluate(() => (window.__CHAT_PERF__?.events ?? []).map((event) => event.type).join(",")),
      { timeout: 15_000 },
    ).toMatch(/submit.*first-token.*stream-end|submit.*stream-end.*first-token/);
    const finalEvents = await page.evaluate(() => window.__CHAT_PERF__?.events ?? []);
    expect(finalEvents.some((event) => event.type === "submit")).toBe(true);
    expect(finalEvents.some((event) => event.type === "first-token")).toBe(true);
    expect(finalEvents.some((event) => event.type === "stream-end")).toBe(true);
  });
});
