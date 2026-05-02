/**
 * Migrations for the chat performance plan + multi-tenant backfill.
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
 *
 * 0008_backfill_site_id: stamp `siteId` onto every legacy row that pre-dates
 * the multi-tenant migration. Rows without `siteId` are currently treated
 * as Diana via `rowBelongsToSite`. That fallback is safe only as long as
 * Diana is the sole publisher: as soon as a second site publishes a row
 * with a colliding key (e.g. a slug, email, roomId, or path that already
 * exists for Diana), the legacy `by_*` index lookup can return the wrong
 * site's row. Backfill closes that hole. Run BEFORE onboarding any second
 * site.
 *
 *   bunx convex run migrations:backfillSiteIdDryRun
 *   bunx convex run migrations:backfillSiteIdsAll
 */

import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_SITE_SLUG } from "./lib/site";

const BATCH_SIZE = 200;

const BACKFILL_TABLES = [
  "documents",
  "meta",
  "pdfAssets",
  "fileAssets",
  "conversations",
  "messages",
  "users",
  "guestNames",
  "commentRooms",
  "userSessions",
] as const;

type BackfillTable = (typeof BACKFILL_TABLES)[number];

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

// ── 0008_backfill_site_id ────────────────────────────────────────

export interface BackfillDryRunResult {
  table: BackfillTable;
  total: number;
  needsBackfill: number;
}

async function resolveDefaultSiteId(ctx: QueryCtx | MutationCtx) {
  const site = await ctx.db
    .query("sites")
    .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_SITE_SLUG))
    .first();
  if (!site) {
    throw new Error(
      `Default site '${DEFAULT_SITE_SLUG}' not found. Run sites:ensureDiana first.`,
    );
  }
  return site._id;
}

async function countTable(
  ctx: QueryCtx,
  table: BackfillTable,
): Promise<{ total: number; needsBackfill: number }> {
  let total = 0;
  let needsBackfill = 0;
  for await (const row of ctx.db.query(table)) {
    total++;
    if ((row as { siteId?: unknown }).siteId === undefined) needsBackfill++;
  }
  return { total, needsBackfill };
}

export const backfillSiteIdDryRun = query({
  args: {},
  handler: async (ctx): Promise<BackfillDryRunResult[]> => {
    const results: BackfillDryRunResult[] = [];
    for (const table of BACKFILL_TABLES) {
      const { total, needsBackfill } = await countTable(ctx, table);
      results.push({ table, total, needsBackfill });
    }
    return results;
  },
});

export interface BackfillBatchResult {
  table: BackfillTable;
  scanned: number;
  patched: number;
  hasMore: boolean;
  cursor: string | null;
}

/**
 * Patch one batch of rows in a single table. The caller loops until
 * `hasMore` is false. Each table has its own cursor space; the wrapper
 * script `scripts/admin/backfill-site-ids.ts` drives all tables to
 * completion.
 */
export const backfillSiteIdsBatch = mutation({
  args: {
    table: v.union(
      v.literal("documents"),
      v.literal("meta"),
      v.literal("pdfAssets"),
      v.literal("fileAssets"),
      v.literal("conversations"),
      v.literal("messages"),
      v.literal("users"),
      v.literal("guestNames"),
      v.literal("commentRooms"),
      v.literal("userSessions"),
    ),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { table, cursor }): Promise<BackfillBatchResult> => {
    const siteId = await resolveDefaultSiteId(ctx);
    const page = await ctx.db
      .query(table)
      .paginate({ cursor: cursor ?? null, numItems: BATCH_SIZE });
    let patched = 0;
    for (const row of page.page) {
      if ((row as { siteId?: unknown }).siteId !== undefined) continue;
      await ctx.db.patch(row._id, { siteId });
      patched++;
    }
    return {
      table,
      scanned: page.page.length,
      patched,
      hasMore: !page.isDone,
      cursor: page.continueCursor,
    };
  },
});
