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

export const updateStreaming = mutation({
  args: {
    conversationId: v.id("conversations"),
    text: v.string(),
  },
  handler: async (ctx, { conversationId, text }) => {
    await ctx.db.patch(conversationId, { streamingText: text });
  },
});

export const clearStreaming = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    await ctx.db.patch(conversationId, { streamingText: undefined });
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
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        parts: v.optional(v.string()),
        createdAt: v.number(),
      })
    ),
    updateTitle: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, messages, updateTitle }) => {
    for (const msg of messages) {
      await ctx.db.insert("messages", { conversationId, ...msg });
    }
    const updates: Record<string, number | string> = {
      updatedAt: Date.now(),
    };
    if (updateTitle) updates.title = updateTitle;
    await ctx.db.patch(conversationId, updates);
  },
});
