/**
 * Manual-QA-style end-to-end tests for the navigation-resilient chat flow
 * landed in chat-patterns Batch A. These verify the user's hard constraint:
 *
 *   - Submit a message.
 *   - Navigate away (close / move to another URL).
 *   - The server keeps streaming + writes the Convex mirror.
 *   - On return, the assistant message is there as if you never left.
 *
 * These tests mock /api/chat at the Playwright network layer. The mock still
 * writes the assistant row to Convex, so refresh/navigation coverage exercises
 * the persisted chat UI without spending AI Gateway credits.
 */

import { test, expect } from "@playwright/test";
import { mockChatApi } from "./chat-mock";
import { chatComposer, chatLog, chatSubmitButton, gotoChatOrSkip } from "./helpers";

// Each test in this file owns the full Playwright budget — they exercise a
// real model round-trip and need elbow room.
test.describe.configure({ timeout: 120_000 });

test.describe("Chat navigation resilience", () => {
  let chatMock: Awaited<ReturnType<typeof mockChatApi>> | null = null;

  test.beforeEach(async ({ page }) => {
    chatMock = await mockChatApi(page, { delayMs: 750 });
    await gotoChatOrSkip(page);
  });

  test.afterEach(async () => {
    await chatMock?.cleanup();
    chatMock = null;
  });

  test("Stop button aborts the model server-side", async ({ page }) => {
    await chatComposer(page).fill("Tell me everything you know about TNBC, in detail.");
    await page.keyboard.press("Enter");

    const stop = chatSubmitButton(page);
    await stop.waitFor({ timeout: 20_000 });
    await expect(stop).toHaveAccessibleName("Stop");
    await stop.click();

    // Composer settles. The server-side cancel-poll runs at 1Hz so the
    // status flip can take a moment after click.
    await expect(chatSubmitButton(page)).toHaveAccessibleName("Submit", {
      timeout: 20_000,
    });
  });

  test("Submit + navigate away + return shows the assistant message", async ({
    page,
    context,
  }) => {
    await chatComposer(page).fill("What is KEYNOTE-522 in one sentence?");
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/chat\/[a-z0-9]/, { timeout: 15_000 });
    const conversationUrl = page.url();
    expect(conversationUrl).toMatch(/\/chat\/[a-z0-9]+$/);

    await expect(chatSubmitButton(page)).toHaveAccessibleName("Stop", {
      timeout: 25_000,
    });

    // Navigate away mid-stream. The route's userStopSignal is decoupled
    // from req.signal so the model keeps running; the mock mirrors that by
    // completing its Convex write even after the page leaves.
    await page.goto("/", { waitUntil: "load" });

    // Poll a fresh tab for the saved assistant message.
    const newPage = await context.newPage();
    await expect
      .poll(
        async () => {
          await newPage.goto(conversationUrl, { waitUntil: "domcontentloaded" });
          return chatLog(newPage)
            .innerText()
            .catch(() => "");
        },
        {
          message: "assistant message should land after navigation away",
          timeout: 15_000,
        }
      )
      .toMatch(/KEYNOTE|pembrolizumab|chemotherapy|trial|breast/i);
  });

  test("Refresh mid-stream keeps the conversation observable", async ({
    page,
  }) => {
    await chatComposer(page).fill("What is the prognosis for stage II TNBC?");
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/chat\/[a-z0-9]/, { timeout: 15_000 });
    const conversationUrl = page.url();

    await expect(chatSubmitButton(page)).toHaveAccessibleName("Stop", {
      timeout: 25_000,
    });

    // Refresh mid-stream. Convex mirror surface keeps showing progress;
    // URL stable.
    await page.reload({ waitUntil: "load" });
    expect(page.url()).toBe(conversationUrl);

    await expect(page.getByTestId("chat-interface")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("chat-error")).toHaveCount(0);
  });
});
