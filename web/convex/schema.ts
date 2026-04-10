import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  documents: defineTable({
    slug: v.string(),
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    contentHash: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    embeddingHash: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["slug", "tags"],
    })
    .searchIndex("search_title", {
      searchField: "title",
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),

  conversations: defineTable({
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    archived: v.optional(v.boolean()),
    streamingText: v.optional(v.string()),
    streamingParts: v.optional(v.string()), // JSON-serialized parts array
    streamingUpdatedAt: v.optional(v.number()),
  }).index("by_updated", ["updatedAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    parts: v.optional(v.string()), // JSON-serialized UIMessage parts
    disabled: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId", "createdAt"]),
});
