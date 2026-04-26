import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("conversations")
      .withIndex("by_updated")
      .order("desc")
      .take(100);
    return all.filter((c) => !c.archived);
  },
});

export const listArchived = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("conversations")
      .withIndex("by_updated")
      .order("desc")
      .take(100);
    return all.filter((c) => c.archived);
  },
});

export const get = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const conversation = await ctx.db.get(id);
    if (!conversation) return null;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", id))
      .collect();
    return { ...conversation, messages };
  },
});

/**
 * PR 28 review — Data Subscriptions: streaming patches must NOT invalidate
 * the message-history query. This query only reads the `messages` table, so
 * patches to `conversations.streamingText` / `streamingParts` / `activeRunId`
 * do not cause Convex to re-run it. The hot path uses `getStreamingState`
 * (below) for streaming updates.
 */
export const getMessages = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", id))
      .collect();
  },
});

/** Minimal conversation metadata (title, archived, etc) without messages or streaming state. */
export const getMeta = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const c = await ctx.db.get(id);
    if (!c) return null;
    return {
      _id: c._id,
      title: c.title,
      archived: c.archived,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  },
});

/** Lightweight query for streaming state only — high-frequency hot path. */
export const getStreamingState = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const conv = await ctx.db.get(id);
    if (!conv) return null;
    return {
      streamingText: conv.streamingText,
      streamingParts: conv.streamingParts,
      streamingUpdatedAt: conv.streamingUpdatedAt,
      activeRunId: conv.activeRunId,
    };
  },
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      title,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Begin a new turn. Sets activeRunId and clears any prior canceledAt /
 * streaming row so a stale cancel doesn't kill the new turn. Subsequent
 * updateStreaming / clearStreaming / saveMessages calls must pass the same
 * runId; mutations with mismatched runId become no-ops.
 */
export const beginRun = mutation({
  args: {
    conversationId: v.id("conversations"),
    runId: v.string(),
  },
  handler: async (ctx, { conversationId, runId }) => {
    await ctx.db.patch(conversationId, {
      activeRunId: runId,
      canceledAt: undefined,
      streamingText: "",
      streamingParts: undefined,
      streamingUpdatedAt: Date.now(),
    });
  },
});

export const updateStreaming = mutation({
  args: {
    conversationId: v.id("conversations"),
    runId: v.optional(v.string()),
    text: v.string(),
    parts: v.optional(v.union(v.string(), v.array(v.any()))),
  },
  handler: async (ctx, { conversationId, runId, text, parts }) => {
    if (runId) {
      const existing = await ctx.db.get(conversationId);
      if (!existing || existing.activeRunId !== runId) return;
    }
    const patch: Record<string, unknown> = {
      streamingText: text,
      streamingUpdatedAt: Date.now(),
    };
    if (parts !== undefined) patch.streamingParts = parts;
    await ctx.db.patch(conversationId, patch);
  },
});

export const clearStreaming = mutation({
  args: {
    conversationId: v.id("conversations"),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, runId }) => {
    if (runId) {
      const existing = await ctx.db.get(conversationId);
      if (!existing || existing.activeRunId !== runId) return;
    }
    await ctx.db.patch(conversationId, {
      streamingText: undefined,
      streamingParts: undefined,
      streamingUpdatedAt: undefined,
      activeRunId: undefined,
    });
  },
});

/** Stop-button signal. The route polls canceledAt and aborts the model. */
export const cancelStream = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    await ctx.db.patch(conversationId, { canceledAt: Date.now() });
  },
});

/** Cleared at the start of every new turn so prior cancellations don't kill it. */
export const clearCancel = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    await ctx.db.patch(conversationId, { canceledAt: undefined });
  },
});

/** Read just the cancel + streaming flags. Cheap, polled by the route. */
export const getCancelState = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv) return null;
    return {
      canceledAt: conv.canceledAt,
      streamingText: conv.streamingText,
      activeRunId: conv.activeRunId,
    };
  },
});

export const archive = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { archived: true, updatedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { archived: false, updatedAt: Date.now() });
  },
});

export const saveMessages = mutation({
  args: {
    conversationId: v.id("conversations"),
    /** runId guard — mutation is a no-op if it doesn't match the active run. */
    runId: v.optional(v.string()),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        parts: v.optional(v.union(v.string(), v.array(v.any()))),
        createdAt: v.number(),
        // Phase 7: optional server-generated id for idempotent inserts.
        messageId: v.optional(v.string()),
      })
    ),
    updateTitle: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, runId, messages, updateTitle }) => {
    if (runId) {
      const existing = await ctx.db.get(conversationId);
      if (!existing || existing.activeRunId !== runId) return;
    }
    for (const msg of messages) {
      // Idempotent path: if messageId is provided and a row with that
      // (conversationId, messageId) already exists, skip the insert.
      if (msg.messageId) {
        const existing = await ctx.db
          .query("messages")
          .withIndex("by_message_id", (q) =>
            q.eq("conversationId", conversationId).eq("messageId", msg.messageId)
          )
          .first();
        if (existing) continue;
      }
      await ctx.db.insert("messages", { conversationId, ...msg });
    }
    const updates: Record<string, number | string> = {
      updatedAt: Date.now(),
    };
    if (updateTitle) updates.title = updateTitle;
    await ctx.db.patch(conversationId, updates);
  },
});

export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    text: v.string(),
  },
  handler: async (ctx, { conversationId, text }) => {
    // Save the user message
    await ctx.db.insert("messages", {
      conversationId,
      role: "user",
      content: text,
      createdAt: Date.now(),
    });
    await ctx.db.patch(conversationId, {
      updatedAt: Date.now(),
      streamingText: "",
      streamingUpdatedAt: Date.now(),
    });
  },
});

export const disableMessage = mutation({
  args: { id: v.id("messages") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { disabled: true });
  },
});
