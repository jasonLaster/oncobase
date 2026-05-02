import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";

type AnyCtx = QueryCtx | MutationCtx;

async function listAll(ctx: AnyCtx, site: SiteCtx) {
  // Conversations are typically small per site; collect + filter is fine.
  const all = await ctx.db
    .query("conversations")
    .withIndex("by_updated")
    .order("desc")
    .take(200);
  return all.filter((c) => rowBelongsToSite(c, site));
}

async function getOwnedConversation(ctx: AnyCtx, site: SiteCtx, id: string) {
  const convId = ctx.db.normalizeId("conversations", id);
  if (!convId) return null;
  const conversation = await ctx.db.get(convId);
  if (!conversation || !rowBelongsToSite(conversation, site)) return null;
  return { convId, conversation };
}

export const list = query({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const all = await listAll(ctx, site);
    return all.filter((c) => !c.archived).slice(0, 100);
  },
});

export const listArchived = query({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const all = await listAll(ctx, site);
    return all.filter((c) => c.archived).slice(0, 100);
  },
});

export const get = query({
  args: { id: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { id, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const owned = await getOwnedConversation(ctx, site, id);
    if (!owned) return null;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", owned.convId))
      .collect();
    return { ...owned.conversation, messages };
  },
});

export const getMessages = query({
  args: { id: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { id, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const owned = await getOwnedConversation(ctx, site, id);
    if (!owned) return [];
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", owned.convId))
      .collect();
  },
});

export const getMeta = query({
  args: { id: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { id, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const owned = await getOwnedConversation(ctx, site, id);
    if (!owned) return null;
    const c = owned.conversation;
    return {
      _id: c._id,
      title: c.title,
      archived: c.archived,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  },
});

export const getStreamingState = query({
  args: { id: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { id, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const owned = await getOwnedConversation(ctx, site, id);
    if (!owned) return null;
    const conv = owned.conversation;
    return {
      streamingText: conv.streamingText,
      streamingParts: conv.streamingParts,
      streamingUpdatedAt: conv.streamingUpdatedAt,
      activeRunId: conv.activeRunId,
    };
  },
});

export const create = mutation({
  args: { title: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { title, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      title,
      createdAt: now,
      updatedAt: now,
    });
  },
});

async function ensureOwnedConvById(
  ctx: AnyCtx,
  site: SiteCtx,
  conversationId: Id<"conversations">,
): Promise<Doc<"conversations"> | null> {
  const conv = await ctx.db.get(conversationId);
  if (!conv || !rowBelongsToSite(conv, site)) return null;
  return conv;
}

export const beginRun = mutation({
  args: {
    conversationId: v.id("conversations"),
    runId: v.string(),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, runId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!(await ensureOwnedConvById(ctx, site, conversationId))) return;
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
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, runId, text, parts, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const conv = await ensureOwnedConvById(ctx, site, conversationId);
    if (!conv) return;
    if (runId && conv.activeRunId !== runId) return;
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
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, runId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const conv = await ensureOwnedConvById(ctx, site, conversationId);
    if (!conv) return;
    if (runId && conv.activeRunId !== runId) return;
    await ctx.db.patch(conversationId, {
      streamingText: undefined,
      streamingParts: undefined,
      streamingUpdatedAt: undefined,
      activeRunId: undefined,
    });
  },
});

export const cancelStream = mutation({
  args: {
    conversationId: v.id("conversations"),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!(await ensureOwnedConvById(ctx, site, conversationId))) return;
    await ctx.db.patch(conversationId, { canceledAt: Date.now() });
  },
});

export const clearCancel = mutation({
  args: {
    conversationId: v.id("conversations"),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!(await ensureOwnedConvById(ctx, site, conversationId))) return;
    await ctx.db.patch(conversationId, { canceledAt: undefined });
  },
});

export const getCancelState = query({
  args: {
    conversationId: v.id("conversations"),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const conv = await ensureOwnedConvById(ctx, site, conversationId);
    if (!conv) return null;
    return {
      canceledAt: conv.canceledAt,
      streamingText: conv.streamingText,
      activeRunId: conv.activeRunId,
    };
  },
});

export const archive = mutation({
  args: { id: v.id("conversations"), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { id, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!(await ensureOwnedConvById(ctx, site, id))) return;
    await ctx.db.patch(id, { archived: true, updatedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { id: v.id("conversations"), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { id, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!(await ensureOwnedConvById(ctx, site, id))) return;
    await ctx.db.patch(id, { archived: false, updatedAt: Date.now() });
  },
});

export const saveMessages = mutation({
  args: {
    conversationId: v.id("conversations"),
    runId: v.optional(v.string()),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        parts: v.optional(v.union(v.string(), v.array(v.any()))),
        createdAt: v.number(),
        messageId: v.optional(v.string()),
      }),
    ),
    updateTitle: v.optional(v.string()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { conversationId, runId, messages, updateTitle, siteSlug },
  ) => {
    const site = await requireSite(ctx, siteSlug);
    const conv = await ensureOwnedConvById(ctx, site, conversationId);
    if (!conv) return;
    if (runId && conv.activeRunId !== runId) return;
    for (const msg of messages) {
      if (msg.messageId) {
        const existing = await ctx.db
          .query("messages")
          .withIndex("by_message_id", (q) =>
            q.eq("conversationId", conversationId).eq("messageId", msg.messageId),
          )
          .first();
        if (existing) continue;
      }
      await ctx.db.insert("messages", {
        ...(site.siteId ? { siteId: site.siteId } : {}),
        conversationId,
        ...msg,
      });
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
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, text, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!(await ensureOwnedConvById(ctx, site, conversationId))) return;
    await ctx.db.insert("messages", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
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
  args: { id: v.id("messages"), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { id, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const msg = await ctx.db.get(id);
    if (!msg || !rowBelongsToSite(msg, site)) return;
    await ctx.db.patch(id, { disabled: true });
  },
});
