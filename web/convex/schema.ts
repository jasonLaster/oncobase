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
    description: v.optional(v.string()),
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

  meta: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),

  pdfAssets: defineTable({
    path: v.string(),      // relative path within obsidian/ (e.g. "sources/paper.pdf")
    blobUrl: v.string(),   // Vercel Blob URL (public)
    sizeBytes: v.number(),
    uploadedAt: v.number(),
  }).index("by_path", ["path"]),

  fileAssets: defineTable({
    path: v.string(),      // relative path within obsidian/ (e.g. "sources/images/foo.jpg")
    blobUrl: v.string(),   // Vercel Blob URL (public)
    sizeBytes: v.number(),
    uploadedAt: v.number(),
  }).index("by_path", ["path"]),

  conversations: defineTable({
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    archived: v.optional(v.boolean()),
    streamingText: v.optional(v.string()),
    // Phase 2 of chat-perf: parts are stored as a typed array. The string form
    // is still accepted for in-flight rows that pre-date the migration; new
    // writes always use the array form. See convex/migrations.ts.
    streamingParts: v.optional(v.union(v.string(), v.array(v.any()))),
    streamingUpdatedAt: v.optional(v.number()),
    // Batch A of chat-patterns: when set, the route's userStopSignal aborts on
    // the next throttled poll. Lets the Stop button decouple from req.signal.
    canceledAt: v.optional(v.number()),
    // PR 28 review: every active stream carries a runId. Convex mutations
    // reject writes whose runId doesn't match the current active runId so a
    // stale flush from a prior run can't clobber a newer one.
    activeRunId: v.optional(v.string()),
  }).index("by_updated", ["updatedAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    parts: v.optional(v.union(v.string(), v.array(v.any()))),
    disabled: v.optional(v.boolean()),
    createdAt: v.number(),
    // Phase 7: server-generated stable id. Lets saveMessages be idempotent
    // under retries (route gets re-invoked, double-finish, etc). Optional
    // for backward compat with existing rows.
    messageId: v.optional(v.string()),
  })
    .index("by_conversation", ["conversationId", "createdAt"])
    .index("by_message_id", ["conversationId", "messageId"]),

  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_email", ["email"]),

  guestNames: defineTable({
    guestId: v.string(),
    name: v.string(),
    updatedAt: v.number(),
  }).index("by_guest_id", ["guestId"]),

  commentRooms: defineTable({
    roomId: v.string(), // e.g. "markdown:wiki/diagnosis"
    threadCount: v.number(),
    updatedAt: v.number(),
  }).index("by_room_id", ["roomId"]),

  userSessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user", ["userId"]),
});
