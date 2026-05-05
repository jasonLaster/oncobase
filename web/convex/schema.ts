import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Multi-tenant migration: every tenant-owned row carries an optional
// siteId. It is optional during the Diana backfill window — operator
// migration code populates it for legacy rows. New writes always set
// it. Search and vector indexes include siteId in filterFields so
// ranking does not leak across sites.
//
// The "siteSlug" handle is the human-readable one used everywhere
// outside Convex (host resolution, blob keys, cache tags); inside
// Convex we use the Id<"sites"> for joins.

export default defineSchema({
  sites: defineTable({
    slug: v.string(),
    name: v.string(),
    ownerEmail: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    domains: v.array(v.string()),
    publishTokenHash: v.string(),
    config: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      enableChat: v.boolean(),
      enableComments: v.boolean(),
      enableDownloads: v.boolean(),
      passwordGate: v.boolean(),
      passwordHash: v.optional(v.string()),
      redirects: v.optional(
        v.array(v.object({ from: v.string(), to: v.string() })),
      ),
      piiPatterns: v.optional(v.array(v.string())),
      previewSeedSlugs: v.optional(v.array(v.string())),
      exclusions: v.optional(v.array(v.string())),
    }),
    liveblocksWorkspaceId: v.optional(v.string()),
    liveblocksSecretKey: v.optional(v.string()),
    liveblocksPublicKey: v.optional(v.string()),
    quotas: v.object({
      monthlyOpenAITokens: v.number(),
      blobBytes: v.number(),
    }),
    monthlyTokensUsed: v.optional(v.number()),
    lastPublishedAt: v.optional(v.number()),
    lastPublishStatus: v.optional(v.string()),
    lastPublishError: v.optional(v.string()),
    publishLockUntil: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_domains", ["domains"])
    .index("by_liveblocks_workspace", ["liveblocksWorkspaceId"]),

  documents: defineTable({
    siteId: v.optional(v.id("sites")),
    slug: v.string(),
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    contentHash: v.optional(v.string()),
    // Recipe version that produced contentHash. Lets /begin
    // distinguish content edits from hash-format upgrades; absent
    // for legacy rows that pre-date this field.
    hashFunctionVersion: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    embeddingHash: v.optional(v.string()),
    description: v.optional(v.string()),
    sensitive: v.optional(v.boolean()),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_slug", ["slug"])
    .index("by_site_slug", ["siteId", "slug"])
    .index("by_site_sensitive_slug", ["siteId", "sensitive", "slug"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["siteId", "slug", "tags"],
    })
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["siteId"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["siteId"],
    }),

  meta: defineTable({
    siteId: v.optional(v.id("sites")),
    key: v.string(),
    value: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_site_key", ["siteId", "key"]),

  pdfAssets: defineTable({
    siteId: v.optional(v.id("sites")),
    path: v.string(),
    blobUrl: v.string(),
    sizeBytes: v.number(),
    contentHash: v.optional(v.string()),
    uploadedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_path", ["path"])
    .index("by_site_path", ["siteId", "path"]),

  fileAssets: defineTable({
    siteId: v.optional(v.id("sites")),
    path: v.string(),
    blobUrl: v.string(),
    sizeBytes: v.number(),
    contentHash: v.optional(v.string()),
    uploadedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_path", ["path"])
    .index("by_site_path", ["siteId", "path"]),

  conversations: defineTable({
    siteId: v.optional(v.id("sites")),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    archived: v.optional(v.boolean()),
    streamingText: v.optional(v.string()),
    streamingParts: v.optional(v.union(v.string(), v.array(v.any()))),
    streamingUpdatedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    activeRunId: v.optional(v.string()),
  })
    .index("by_updated", ["updatedAt"])
    .index("by_site_updated", ["siteId", "updatedAt"]),

  messages: defineTable({
    siteId: v.optional(v.id("sites")),
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    parts: v.optional(v.union(v.string(), v.array(v.any()))),
    disabled: v.optional(v.boolean()),
    createdAt: v.number(),
    messageId: v.optional(v.string()),
  })
    .index("by_conversation", ["conversationId", "createdAt"])
    .index("by_message_id", ["conversationId", "messageId"])
    .index("by_site_conversation", ["siteId", "conversationId", "createdAt"]),

  users: defineTable({
    siteId: v.optional(v.id("sites")),
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_site_email", ["siteId", "email"]),

  guestNames: defineTable({
    siteId: v.optional(v.id("sites")),
    guestId: v.string(),
    name: v.string(),
    updatedAt: v.number(),
  })
    .index("by_guest_id", ["guestId"])
    .index("by_site_guest", ["siteId", "guestId"]),

  commentRooms: defineTable({
    siteId: v.optional(v.id("sites")),
    roomId: v.string(),
    threadCount: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_id", ["roomId"])
    .index("by_site_room", ["siteId", "roomId"]),

  userSessions: defineTable({
    siteId: v.optional(v.id("sites")),
    userId: v.id("users"),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user", ["userId"])
    .index("by_site_token", ["siteId", "tokenHash"]),
});
