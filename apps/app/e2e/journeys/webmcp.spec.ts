import { expect, test } from "@playwright/test";
import { callTool, installModelContextStub, toolNames } from "../webmcp-stub";
import { article, openPage, passGate, requireLocalStack } from "./helpers";

// WebMCP tools against the real backend: search, read and navigate the wiki.
// (The education library tools are covered with mocked endpoints in
// e2e/webmcp.spec.ts: the local stack publishes no education pages.)
requireLocalStack();

test.describe("WebMCP tools (real backend)", () => {
  test.beforeEach(async ({ page }) => installModelContextStub(page));

  test("an agent searches the wiki, reads the best page with its links, and opens it", async ({ page }) => {
    await passGate(page);
    await openPage(page, "/");
    await expect.poll(() => toolNames(page)).toContain("search_wiki");

    const search = await callTool(page, "search_wiki", { query: "lumpectomy" });
    expect(search.results.length).toBeGreaterThan(0);
    const hit = search.results[0];
    expect(hit.matches[0].text).toMatch(/lumpectomy/i);

    const read = await callTool(page, "read_page", { slug: hit.slug, max_chars: 2000 });
    expect(read.content).toMatch(/lumpectomy/i);
    expect(read.outline.length).toBeGreaterThan(0);

    const related = await callTool(page, "get_related_pages", { slug: hit.slug });
    expect(Array.isArray(related.backlinks)).toBe(true);

    const opened = await callTool(page, "open_page", { slug: hit.slug });
    expect(opened.opened).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/${hit.slug}$`));
    await expect(article(page)).toHaveAccessibleName(read.title);
  });

  test("ask_wiki_chat opens the chat and sends the question once (fake model)", async ({ page }) => {
    await passGate(page);
    await openPage(page, "/");
    await expect.poll(() => toolNames(page)).toContain("ask_wiki_chat");
    await callTool(page, "ask_wiki_chat", { question: "What is a lumpectomy?" });
    const chat = page.getByTestId("chat-interface");
    await expect(chat).toHaveAttribute("data-chat-conversation-id", /^(?!new$).+/);
    await expect(page).toHaveURL(/\/chat\/[^/?]+$/);
    await expect(page.getByTestId("chat-assistant-message").last()).toContainText("fake-reply: What is a lumpectomy?");
    await page.reload();
    await expect(page.getByTestId("chat-assistant-message")).toHaveCount(1);
  });
});

