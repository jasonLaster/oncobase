import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  conversations: defineTable({
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    archived: v.optional(v.boolean()),
    streamingText: v.optional(v.string()),
  }).index("by_updated", ["updatedAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    parts: v.optional(v.string()), // JSON-serialized UIMessage parts
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId", "createdAt"]),
});
