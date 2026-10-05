import { expect, test, type Page } from "@playwright/test";
import { passGate, requireLocalStack } from "./helpers";

// Real backend, real streaming transport and persistence. Only the model call
// is replaced: the local stack sets WIKI_CHAT_FAKE_MODEL=1, so the server
// answers "fake-reply: <prompt>" (a "[slow]" prompt keeps streaming for ~6s so
// Stop and queueing can be exercised mid-stream). See server/fake-chat-model.ts.
requireLocalStack();

const composer = (page: Page) => page.getByTestId("chat-composer-textarea");
const chat = (page: Page) => page.getByTestId("chat-interface");
const lastReply = (page: Page) => page.getByTestId("chat-assistant-message").last();

async function openChat(page: Page) {
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await expect(composer(page)).toBeVisible();
}

async function send(page: Page, prompt: string) {
  await composer(page).fill(prompt);
  await page.getByTestId("chat-submit-button").click();
  await expect(chat(page)).toHaveAttribute("data-chat-conversation-id", /^(?!new$).+/);
  return (await chat(page).getAttribute("data-chat-conversation-id"))!;
}

test.describe("chat (real backend, fake model)", () => {
  test.beforeEach(async ({ page }) => passGate(page));

  test("the chat page renders its composer, one conversation list and archived navigation", async ({ page }) => {
    await openChat(page);
    const sidebar = page.getByTestId("chat-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId("conversation-list")).toBeVisible();
    // The mobile sheet keeps a hidden second list in the DOM; exactly one is visible.
    await expect(page.locator('[data-test-id="conversation-list"]:visible')).toHaveCount(1);
    await expect(chat(page)).toBeVisible();
    await expect(page.getByTestId("chat-suggested-prompts")).toBeVisible();

    await sidebar.getByTestId("conversation-list-archived").click();
    await expect(page).toHaveURL(/\/chat\/archived$/);
    await expect(page.getByRole("heading", { name: "Archived Chats" })).toBeVisible();
  });

  test("a sent message streams a reply and the conversation survives a reload", async ({ page }) => {
    await openChat(page);
    const prompt = `hello ${Date.now()}`;
    const id = await send(page, prompt);
    await expect(lastReply(page)).toContainText(`fake-reply: ${prompt}`);
    await expect(page).toHaveURL(new RegExp(`/chat/${id}$`));

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(chat(page)).toHaveAttribute("data-chat-conversation-id", id);
    await expect(page.getByTestId("chat-user-message").last()).toContainText(prompt);
    await expect(lastReply(page)).toContainText(`fake-reply: ${prompt}`);
  });

  test("Stop mid-stream keeps the message and does not auto-resume on reload", async ({ page }) => {
    let chatCalls = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/chat" && request.method() === "POST") chatCalls += 1;
    });
    await openChat(page);
    const prompt = `stop me [slow] ${Date.now()}`;
    await send(page, prompt);
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible();
    await expect.poll(() => chatCalls).toBe(1);
    await stop.click();
    await expect(chat(page)).toHaveAttribute("data-chat-status", /ready|error/);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-message-log")).toContainText(prompt);
    await expect(chat(page)).toHaveAttribute("data-chat-status", "ready");
    await expect(stop).toBeHidden();
    // Give an erroneous auto-resume time to fire before asserting it did not.
    await page.waitForTimeout(1500);
    expect(chatCalls).toBe(1);
    await expect(chat(page)).toHaveAttribute("data-chat-status", "ready");
  });

  test("a message sent while a reply streams is queued, then sent", async ({ page }) => {
    await openChat(page);
    await send(page, `first [slow] ${Date.now()}`);
    await expect(chat(page)).toHaveAttribute("data-chat-status", /submitted|streaming/);

    const queuedPrompt = `queued-pong-${Date.now()}`;
    await composer(page).fill(queuedPrompt);
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("");
    await expect(page.getByTestId("chat-queued-message")).toHaveText(new RegExp(queuedPrompt));

    // When the first reply finishes, the queued prompt is sent and answered.
    await expect(page.getByTestId("chat-queued-message")).toHaveCount(0, { timeout: 30_000 });
    await expect(lastReply(page)).toContainText(`fake-reply: ${queuedPrompt}`, { timeout: 30_000 });
  });

  test("archiving the active conversation resets the new-chat surface", async ({ page }) => {
    await openChat(page);
    const prompt = `archive-reset-${Date.now()}`;
    const id = await send(page, prompt);
    await expect(lastReply(page)).toContainText(`fake-reply: ${prompt}`);

    const item = page.getByTestId("chat-sidebar").locator(`[data-conversation-id="${id}"]`);
    await item.locator("..").getByRole("button", { name: "Conversation actions" }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();

    await expect(page).toHaveURL(/\/chat$/);
    await expect(chat(page)).toHaveAttribute("data-chat-conversation-id", "new");
    await expect(chat(page)).not.toContainText(prompt);
    await expect(page.getByTestId("chat-suggested-prompts")).toBeVisible();
  });

  test("navigating away mid-reply and back shows the assistant message", async ({ page }) => {
    await openChat(page);
    const prompt = `navigation-resilience ${Date.now()}`;
    const id = await send(page, prompt);

    await page.goto("/chat/archived", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-archived-page")).toBeVisible();

    await page.goto(`/chat/${id}`, { waitUntil: "domcontentloaded" });
    await expect(lastReply(page)).toContainText(`fake-reply: ${prompt}`);
  });
});
