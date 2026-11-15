import { expect, test } from "@playwright/test";

// Saved chats live only in this browser. These are seeded, so no reply is requested.
const transcript = (question: string, answer: string) => ({ version: 1, messages: [
  { id: "u1", role: "user", parts: [{ type: "text", text: question }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: answer }] },
] });
const ctdna = "ctdnachat0001", vaccine = "vaccinechat01";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/education/chat", route => route.abort());
  await page.addInitScript(({ ctdna, vaccine, chats }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("oncoguide:learning-chat:saved", JSON.stringify({ version: 1, chats: [
      { id: ctdna, title: "What can a ctDNA test tell us?", updatedAt: Date.now() - 86_400_000 },
      { id: vaccine, title: "How do cancer vaccines work?", updatedAt: Date.now() - 2 * 86_400_000 },
    ] }));
    localStorage.setItem(`oncoguide:learning-chat:saved:${ctdna}`, JSON.stringify(chats[0]));
    localStorage.setItem(`oncoguide:learning-chat:saved:${vaccine}`, JSON.stringify(chats[1]));
  }, { ctdna, vaccine, chats: [transcript("What can a ctDNA test tell us?", "ctDNA is tumor DNA in the blood."), transcript("How do cancer vaccines work?", "They teach T cells a target.")] });
});

test("a returning reader reopens a chat saved in this browser, by list or by URL", async ({ page }) => {
  await page.goto("/education/chat/");
  const saved = page.getByRole("region", { name: "Pick up where you left off" });
  await expect(saved.getByRole("button", { name: /^What can a ctDNA test tell us/ })).toBeVisible();
  await saved.getByRole("button", { name: /^What can a ctDNA test tell us/ }).click();
  await expect(page.locator(".session-chat-assistant")).toContainText("ctDNA is tumor DNA in the blood.");
  await expect(page).toHaveURL(new RegExp(`[?&]chat=${ctdna}`));

  // A reload, or a bookmark in a fresh tab, returns to the same conversation.
  await page.reload();
  await expect(page.locator(".session-chat-assistant")).toContainText("ctDNA is tumor DNA in the blood.");
  const tab = await page.context().newPage();
  await tab.goto(`/education/chat/?chat=${vaccine}`);
  await expect(tab.locator(".session-chat-assistant")).toContainText("They teach T cells a target.");
  await tab.close();

  // New chat leaves the URL and lists every saved chat, newest first.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).not.toHaveURL(/chat=/);
  await expect(saved.locator(".session-chat-saved-open span")).toHaveText(["What can a ctDNA test tell us?", "How do cancer vaccines work?"]);
});

test("a saved chat can be removed, and an unknown ID opens a fresh chat", async ({ page }) => {
  await page.goto("/education/chat/?chat=missingchat99");
  await expect(page.locator(".session-chat-welcome")).toBeVisible();
  await expect(page).not.toHaveURL(/chat=/);
  const saved = page.getByRole("region", { name: "Pick up where you left off" });
  await saved.getByRole("button", { name: "Remove “How do cancer vaccines work?”" }).click();
  await expect(saved.locator(".session-chat-saved-open")).toHaveCount(1);
  expect(await page.evaluate(id => localStorage.getItem(`oncoguide:learning-chat:saved:${id}`), vaccine)).toBeNull();
  await saved.getByRole("button", { name: "Remove “What can a ctDNA test tell us?”" }).click();
  await expect(saved).toHaveCount(0);
});
