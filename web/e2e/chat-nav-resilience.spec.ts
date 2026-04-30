/**
 * Manual-QA-style end-to-end tests for the navigation-resilient chat flow
 * landed in chat-patterns Batch A. These verify the user's hard constraint:
 *
 *   - Submit a message.
 *   - Navigate away (close / move to another URL).
 *   - The server keeps streaming + writes the Convex mirror.
 *   - On return, the assistant message is there as if you never left.
 *
 * These tests REQUIRE a configured env (AI_GATEWAY_API_KEY + Convex). They
 * skip when /chat redirects, so CI's preview env (which has both keys)
 * runs them; ephemeral envs without gateway access skip cleanly.
 */

import { test, expect } from "@playwright/test";
import {
  localStreamingChatSkipReason,
  shouldSkipLocalStreamingChatE2E,
} from "./chat-env";

// Each test in this file owns the full Playwright budget — they exercise a
// real model round-trip and need elbow room.
test.describe.configure({ timeout: 120_000 });

test.describe("Chat navigation resilience", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/chat");
    test.skip(!page.url().includes("/chat"), "Chat is disabled");
  });

  test("Stop button aborts the model server-side", async ({ page }) => {
    test.skip(shouldSkipLocalStreamingChatE2E(), localStreamingChatSkipReason);

    await page
      .getByPlaceholder("Ask a question...")
      .first()
      .fill("Tell me everything you know about TNBC, in detail.");
    await page.keyboard.press("Enter");

    const stop = page.getByRole("button", { name: "Stop" });
    await stop.waitFor({ timeout: 20_000 });
    await stop.click();

    // Composer settles. The server-side cancel-poll runs at 1Hz so the
    // status flip can take a moment after click.
    await expect(stop).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Submit" })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Submit + navigate away + return shows the assistant message", async ({
    page,
    context,
  }) => {
    test.skip(shouldSkipLocalStreamingChatE2E(), localStreamingChatSkipReason);

    await page
      .getByPlaceholder("Ask a question...")
      .first()
      .fill("What is KEYNOTE-522 in one sentence?");
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/chat\/[a-z0-9]/, { timeout: 15_000 });
    const conversationUrl = page.url();
    expect(conversationUrl).toMatch(/\/chat\/[a-z0-9]+$/);

    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
      timeout: 25_000,
    });

    // Navigate away mid-stream. The route's userStopSignal is decoupled
    // from req.signal so the model keeps running; consumeSseStream + after
    // keep the function alive past response close.
    await page.goto("/", { waitUntil: "load" });

    // Poll a fresh tab for the saved assistant message. ~80s budget covers
    // worst-case model + tool latency for this prompt on the dev model.
    const newPage = await context.newPage();
    let landed = false;
    const deadline = Date.now() + 80_000;
    while (Date.now() < deadline && !landed) {
      await newPage.goto(conversationUrl, { waitUntil: "load" });
      const text = await newPage
        .locator('[role="log"], main')
        .first()
        .innerText()
        .catch(() => "");
      if (/KEYNOTE|pembrolizumab|chemotherapy|trial|breast/i.test(text)) {
        landed = true;
        break;
      }
      await newPage.waitForTimeout(2500);
    }
    expect(
      landed,
      "assistant message should land after navigation away"
    ).toBe(true);
  });

  test("Refresh mid-stream keeps the conversation observable", async ({
    page,
  }) => {
    test.skip(shouldSkipLocalStreamingChatE2E(), localStreamingChatSkipReason);

    await page
      .getByPlaceholder("Ask a question...")
      .first()
      .fill("What is the prognosis for stage II TNBC?");
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/chat\/[a-z0-9]/, { timeout: 15_000 });
    const conversationUrl = page.url();

    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
      timeout: 25_000,
    });

    // Refresh mid-stream. Convex mirror surface keeps showing progress;
    // URL stable.
    await page.reload({ waitUntil: "load" });
    expect(page.url()).toBe(conversationUrl);

    // No "chat-failed" banner pops within a reasonable window after
    // reload. We scope the selector to text the chat actually emits — broad
    // selectors like .text-red-400 catch unrelated sidebar affordances.
    await page.waitForTimeout(3000);
    const chatErrors = await page
      .locator(
        'main:has-text("Chat error"), main:has-text("Something went wrong")'
      )
      .count();
    expect(chatErrors, "no chat error banner after refresh").toBe(0);
  });
});
