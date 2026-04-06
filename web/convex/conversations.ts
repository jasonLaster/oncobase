import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_updated")
      .order("desc")
      .take(50);
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

export const saveMessages = mutation({
  args: {
    conversationId: v.id("conversations"),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
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
