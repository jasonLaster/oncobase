import { expect, test } from "@playwright/test";
import { gatedContext, requireLocalStack } from "./helpers";

// Opt-in smokes that spend real model credits. Never part of a default run.
requireLocalStack();

test("AI search ranks pages with live credentials", async ({ baseURL }) => {
  test.skip(process.env.WIKI_VITE_RUN_LIVE_AI_SEARCH !== "1", "Opt in with WIKI_VITE_RUN_LIVE_AI_SEARCH=1");
  test.skip(!process.env.AI_GATEWAY_API_KEY || !process.env.OPENAI_API_KEY, "Needs AI_GATEWAY_API_KEY and OPENAI_API_KEY");
  const context = await gatedContext(baseURL!);
  try {
    const response = await context.post("/api/ai-search", {
      data: { query: "diagnosis", slugs: ["wiki/diagnostics/diagnosis", "wiki/logistics/insurance"] },
      timeout: 60_000,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    expect(response.headers()["x-wiki-cache-scope"]).toBe("public");
    const { results } = await response.json();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toEqual(expect.objectContaining({ slug: expect.any(String), title: expect.any(String), relevance: expect.any(Number), summary: expect.any(String) }));
  } finally {
    await context.dispose();
  }
});

test("chat streams a reply with live credentials", async ({ baseURL }) => {
  test.skip(!process.env.AI_GATEWAY_API_KEY, "Needs AI_GATEWAY_API_KEY");
  const context = await gatedContext(baseURL!);
  try {
    const response = await context.post("/api/chat", {
      data: { messages: [{ id: "msg-test", role: "user", parts: [{ type: "text", text: "Reply with exactly: pong" }] }] },
      timeout: 60_000,
    });
    const text = await response.text();
    expect(response.ok(), text).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("text/event-stream");
    expect(text.toLowerCase()).toContain("pong");
  } finally {
    await context.dispose();
  }
});
