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
    publishTokenHashes: v.optional(v.array(v.string())),
    publishTokens: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          hash: v.string(),
          createdAt: v.number(),
          revokedAt: v.optional(v.number()),
        }),
      ),
    ),
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
    rawContent: v.optional(v.string()),
    tags: v.array(v.string()),
    contentHash: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    sensitiveInclude: v.optional(v.array(v.string())),
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

  dicomSeries: defineTable({
    siteId: v.optional(v.id("sites")),
    seriesKey: v.string(),
    label: v.string(),
    relativeDirectory: v.string(),
    modality: v.optional(v.string()),
    studyDescription: v.optional(v.string()),
    seriesDescription: v.optional(v.string()),
    studyDate: v.optional(v.string()),
    seriesNumber: v.optional(v.number()),
    imageCount: v.number(),
    uploadedAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_series_key", ["seriesKey"])
    .index("by_site_series_key", ["siteId", "seriesKey"])
    .index("by_site_updated", ["siteId", "updatedAt"]),

  dicomImages: defineTable({
    siteId: v.optional(v.id("sites")),
    seriesKey: v.string(),
    path: v.string(),
    fileName: v.string(),
    blobUrl: v.string(),
    sizeBytes: v.number(),
    contentHash: v.optional(v.string()),
    instanceNumber: v.optional(v.number()),
    imagePosition: v.optional(v.number()),
    rows: v.optional(v.number()),
    columns: v.optional(v.number()),
    uploadedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_path", ["path"])
    .index("by_site_path", ["siteId", "path"])
    .index("by_site_series", ["siteId", "seriesKey"]),

  imageAnnotations: defineTable({
    siteId: v.optional(v.id("sites")),
    seriesKey: v.string(),
    imageKey: v.string(),
    imagePath: v.string(),
    annotations: v.array(
      v.object({
        id: v.string(),
        kind: v.union(
          v.literal("arrow"),
          v.literal("circle"),
          v.literal("box"),
          v.literal("text"),
        ),
        x: v.number(),
        y: v.number(),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        endX: v.optional(v.number()),
        endY: v.optional(v.number()),
        text: v.optional(v.string()),
        color: v.string(),
        thickness: v.number(),
        fontSize: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_series", ["siteId", "seriesKey"])
    .index("by_site_image", ["siteId", "seriesKey", "imageKey"]),

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

  roles: defineTable({
    siteId: v.optional(v.id("sites")),
    name: v.string(),
    description: v.optional(v.string()),
    emailPatterns: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_site_name", ["siteId", "name"]),

  rolePermissions: defineTable({
    siteId: v.optional(v.id("sites")),
    roleId: v.id("roles"),
    pathPattern: v.optional(v.string()),
    includePathPatterns: v.optional(v.array(v.string())),
    excludePathPatterns: v.optional(v.array(v.string())),
    includeTags: v.optional(v.array(v.string())),
    excludeTags: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index("by_role", ["roleId"])
    .index("by_site_role", ["siteId", "roleId"]),

  userRoles: defineTable({
    siteId: v.optional(v.id("sites")),
    userId: v.id("users"),
    roleId: v.id("roles"),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_role", ["userId", "roleId"])
    .index("by_site_user", ["siteId", "userId"]),

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

  epicFhirOAuthStates: defineTable({
    siteId: v.optional(v.id("sites")),
    userId: v.optional(v.id("users")),
    providerKey: v.string(),
    stateHash: v.string(),
    redirectUri: v.string(),
    codeVerifierCiphertext: v.string(),
    fhirBaseUrl: v.string(),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_state_hash", ["stateHash"])
    .index("by_site_user", ["siteId", "userId"]),

  epicFhirConnections: defineTable({
    siteId: v.optional(v.id("sites")),
    userId: v.optional(v.id("users")),
    providerKey: v.string(),
    providerName: v.string(),
    fhirBaseUrl: v.string(),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    patientIdCiphertext: v.optional(v.string()),
    scopes: v.array(v.string()),
    accessTokenCiphertext: v.optional(v.string()),
    refreshTokenCiphertext: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("error"),
      v.literal("revoked"),
    ),
    lastObservationIssuedAt: v.optional(v.string()),
    lastDiagnosticReportDate: v.optional(v.string()),
    lastSyncStartedAt: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    lastSyncError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_provider", ["siteId", "providerKey"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_user", ["siteId", "userId"]),

  epicFhirLabResults: defineTable({
    siteId: v.optional(v.id("sites")),
    connectionId: v.id("epicFhirConnections"),
    resourceType: v.string(),
    fhirId: v.string(),
    status: v.optional(v.string()),
    category: v.optional(v.string()),
    codeText: v.optional(v.string()),
    codeSystem: v.optional(v.string()),
    code: v.optional(v.string()),
    effectiveAt: v.optional(v.string()),
    issuedAt: v.optional(v.string()),
    sortAt: v.string(),
    valueText: v.optional(v.string()),
    unit: v.optional(v.string()),
    referenceRangeText: v.optional(v.string()),
    interpretation: v.optional(v.string()),
    rawHash: v.string(),
    rawJsonCiphertext: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_connection_sort", ["siteId", "connectionId", "sortAt"])
    .index("by_site_resource", ["siteId", "resourceType", "fhirId"])
    .index("by_connection_resource", ["connectionId", "resourceType", "fhirId"]),
});
