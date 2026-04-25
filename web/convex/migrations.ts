/**
 * Migrations for the chat performance plan.
 *
 * 0007_native_parts: convert `messages.parts` and `conversations.streamingParts`
 * from JSON-encoded strings to native arrays. Forward-compatible: the schema
 * accepts either form, so this can run online without downtime.
 *
 *   bunx convex run migrations:nativePartsDryRun
 *   bunx convex run migrations:nativeParts
 *
 * Or via web/scripts/migrate-native-parts.ts which adds confirmation +
 * progress logging.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const BATCH_SIZE = 200;

interface DryRunResult {
  totalMessages: number;
  messagesNeedingMigration: number;
  malformedMessages: number;
  totalConversations: number;
  conversationsNeedingMigration: number;
  malformedConversations: number;
}

function tryParseParts(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  if (value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const nativePartsDryRun = query({
  args: {},
  handler: async (ctx): Promise<DryRunResult> => {
    let totalMessages = 0;
    let messagesNeedingMigration = 0;
    let malformedMessages = 0;
    for await (const m of ctx.db.query("messages")) {
      totalMessages++;
      if (m.parts === undefined) continue;
      if (Array.isArray(m.parts)) continue;
      if (typeof m.parts === "string") {
        const parsed = tryParseParts(m.parts);
        if (parsed === null) {
          malformedMessages++;
        } else {
          messagesNeedingMigration++;
        }
      }
    }

    let totalConversations = 0;
    let conversationsNeedingMigration = 0;
    let malformedConversations = 0;
    for await (const c of ctx.db.query("conversations")) {
      totalConversations++;
      if (c.streamingParts === undefined) continue;
      if (Array.isArray(c.streamingParts)) continue;
      if (typeof c.streamingParts === "string") {
        const parsed = tryParseParts(c.streamingParts);
        if (parsed === null) {
          malformedConversations++;
        } else {
          conversationsNeedingMigration++;
        }
      }
    }

    return {
      totalMessages,
      messagesNeedingMigration,
      malformedMessages,
      totalConversations,
      conversationsNeedingMigration,
      malformedConversations,
    };
  },
});

interface BatchResult {
  scanned: number;
  migrated: number;
  malformed: number;
  hasMore: boolean;
  cursor: string | null;
}

export const nativePartsMessagesBatch = mutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<BatchResult> => {
    const page = await ctx.db
      .query("messages")
      .paginate({ cursor: cursor ?? null, numItems: BATCH_SIZE });
    let migrated = 0;
    let malformed = 0;
    for (const m of page.page) {
      if (m.parts === undefined) continue;
      if (Array.isArray(m.parts)) continue;
      if (typeof m.parts !== "string") continue;
      const parsed = tryParseParts(m.parts);
      if (parsed === null) {
        malformed++;
        continue;
      }
      await ctx.db.patch(m._id, { parts: parsed });
      migrated++;
    }
    return {
      scanned: page.page.length,
      migrated,
      malformed,
      hasMore: !page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const nativePartsConversationsBatch = mutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<BatchResult> => {
    const page = await ctx.db
      .query("conversations")
      .paginate({ cursor: cursor ?? null, numItems: BATCH_SIZE });
    let migrated = 0;
    let malformed = 0;
    for (const c of page.page) {
      if (c.streamingParts === undefined) continue;
      if (Array.isArray(c.streamingParts)) continue;
      if (typeof c.streamingParts !== "string") continue;
      const parsed = tryParseParts(c.streamingParts);
      if (parsed === null) {
        malformed++;
        continue;
      }
      await ctx.db.patch(c._id, { streamingParts: parsed });
      migrated++;
    }
    return {
      scanned: page.page.length,
      migrated,
      malformed,
      hasMore: !page.isDone,
      cursor: page.continueCursor,
    };
  },
});
