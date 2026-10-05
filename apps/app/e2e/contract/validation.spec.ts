import { expect, test } from "@playwright/test";
import { gatedContext, requireLocalStack } from "./helpers";

// Backend validation that must hold with no model or Liveblocks credentials.
// Replaces the AI search / chat / tools checks of backend-api and the
// liveblocks-auth/users/delete-thread checks that lived in comments.spec.
requireLocalStack();

test("AI search, chat and tool routes validate input without model credentials", async ({ baseURL }) => {
  const context = await gatedContext(baseURL!);
  try {
    for (const path of ["/api/ai-search", "/api/chat"]) {
      const method = await context.get(path);
      expect(method.status(), path).toBe(405);
      expect(method.headers().allow, path).toBe("POST");
    }

    // An empty query is an empty answer, not a model call.
    const empty = await context.post("/api/ai-search", { data: { query: "" } });
    expect(empty.ok(), await empty.text()).toBeTruthy();
    expect(await empty.json()).toEqual({ results: [] });

    const noMessages = await context.post("/api/chat", { data: { messages: [] } });
    expect(noMessages.status()).toBe(400);
    expect(await noMessages.text()).toContain("messages must not be empty");
    const malformed = await context.post("/api/chat", { data: {} });
    expect(malformed.status()).toBe(400);
    expect(await malformed.text()).toContain("messages");

    for (const data of [{ tool: "nope", args: {} }, {}]) {
      const response = await context.post("/api/tools", { data });
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.text()).toContain("Unknown tool");
    }
  } finally {
    await context.dispose();
  }
});

test("liveblocks auth, users and delete-thread reject bad parameters", async ({ baseURL }) => {
  const context = await gatedContext(baseURL!);
  try {
    const auth = await context.get("/api/liveblocks-auth");
    expect(auth.ok()).toBeTruthy();
    expect(await auth.json()).toEqual(expect.objectContaining({ configured: expect.any(Boolean), siteSlug: expect.any(String) }));

    const users = await context.post("/api/liveblocks-users", { data: { userIds: ["guest_test", 123] } });
    expect(users.status()).toBe(400);
    expect(await users.json()).toEqual({ error: "userIds must only contain strings" });

    const deleteThread = await context.post("/api/liveblocks-delete-thread", { data: {} });
    expect(deleteThread.status()).toBe(400);
    expect(await deleteThread.json()).toEqual({ error: "roomId and threadId are required" });
  } finally {
    await context.dispose();
  }
});
