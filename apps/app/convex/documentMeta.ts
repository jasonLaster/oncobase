/**
 * Operator functions for the `documentMeta` projection (see
 * convex/lib/documentMeta.ts). All internal: run with an admin/deploy key via
 * `scripts/admin/backfill-document-meta.ts` or `npx convex run`.
 *
 * Rollout per site:
 *   1. Deploy (schema + dual-write). Readers still use `documents`.
 *   2. backfillBatch until isDone. The final batch stamps
 *      sites.documentMetaReadyAt, which switches readers to `documentMeta`.
 *      Pass markReady:false to backfill without switching.
 *   3. verifyBatch until isDone; expect missing = stale = 0.
 *   Rollback: setReady { ready: false } (readers return to `documents`;
 *   dual-write continues, so re-enabling needs no new backfill).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSite } from "./lib/site";
import { documentMetadata, syncDocumentMeta, type SyncResult } from "./lib/documentMeta";

// Each documents page reads whole rows (body + embedding). Cap the page by
// bytes as well as count so a run of large documents stays far below Convex's
// 16 MiB per-transaction read limit; the cursor simply advances less.
const DOCUMENT_PAGE_BYTES = 6 * 1024 * 1024;
const DEFAULT_DOCUMENT_PAGE = 100;
// The prune phase reads one document per meta row with ctx.db.get, which has
// no byte cap; keep pages small.
const MAX_PRUNE_PAGE = 25;

type Phase = "documents" | "prune";
const cursorValidator = v.optional(v.union(v.string(), v.null()));

function parseCursor(cursor: string | null | undefined): { phase: Phase; cursor: string | null } {
  if (!cursor) return { phase: "documents", cursor: null };
  const parsed: unknown = JSON.parse(cursor);
  if (!Array.isArray(parsed) || parsed[0] !== "docmeta-backfill-v1" || (parsed[1] !== "documents" && parsed[1] !== "prune") ||
      (parsed[2] !== null && typeof parsed[2] !== "string")) {
    throw new Error("Invalid backfill cursor");
  }
  return { phase: parsed[1], cursor: parsed[2] };
}

async function scopedSite(ctx: Parameters<typeof requireSite>[0], siteSlug: string) {
  const site = await requireSite(ctx, siteSlug);
  if (!site.siteId || !site.site) throw new Error(`site ${siteSlug} not found`);
  return { ...site, siteId: site.siteId, site: site.site };
}

/** Idempotent, resumable backfill for one site. Phase "documents" upserts a
 * meta row for every document of the site; phase "prune" repairs meta rows
 * whose document was removed or re-scoped outside the dual-write helpers.
 * Writes happen only when a row actually differs. */
export const backfillBatch = internalMutation({
  args: { siteSlug: v.string(), cursor: cursorValidator, numItems: v.optional(v.number()), markReady: v.optional(v.boolean()) },
  handler: async (ctx, { siteSlug, cursor, numItems, markReady = true }) => {
    const site = await scopedSite(ctx, siteSlug);
    const position = parseCursor(cursor);
    const counts: Record<SyncResult, number> = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
    let scanned = 0;
    let pageDone: boolean;
    let nativeCursor: string;
    if (position.phase === "documents") {
      const page = await ctx.db.query("documents")
        .withIndex("by_site_slug", q => q.eq("siteId", site.siteId))
        .paginate({ cursor: position.cursor, numItems: Math.max(1, Math.min(numItems ?? DEFAULT_DOCUMENT_PAGE, 500)), maximumBytesRead: DOCUMENT_PAGE_BYTES });
      for (const doc of page.page) {
        scanned++;
        counts[await syncDocumentMeta(ctx, doc._id, doc)]++;
      }
      pageDone = page.isDone;
      nativeCursor = page.continueCursor;
    } else {
      const page = await ctx.db.query("documentMeta")
        .withIndex("by_site_slug", q => q.eq("siteId", site.siteId))
        .paginate({ cursor: position.cursor, numItems: Math.max(1, Math.min(numItems ?? MAX_PRUNE_PAGE, MAX_PRUNE_PAGE)) });
      const seen = new Set<Id<"documents">>();
      for (const row of page.page) {
        scanned++;
        if (seen.has(row.documentId)) continue;
        seen.add(row.documentId);
        counts[await syncDocumentMeta(ctx, row.documentId, await ctx.db.get(row.documentId))]++;
      }
      pageDone = page.isDone;
      nativeCursor = page.continueCursor;
    }
    const finished = pageDone && position.phase === "prune";
    let readyAt = site.site.documentMetaReadyAt ?? null;
    if (finished && markReady && !readyAt) {
      readyAt = Date.now();
      await ctx.db.patch(site.siteId, { documentMetaReadyAt: readyAt });
    }
    const next: [string, Phase, string | null] = pageDone
      ? ["docmeta-backfill-v1", "prune", null]
      : ["docmeta-backfill-v1", position.phase, nativeCursor];
    return {
      phase: position.phase,
      scanned,
      ...counts,
      isDone: finished,
      continueCursor: finished ? null : JSON.stringify(next),
      readyAt,
    };
  },
});

function sameMetadata(row: Doc<"documentMeta">, doc: Doc<"documents">) {
  const expected: Record<string, unknown> = { ...documentMetadata(doc), documentId: doc._id };
  const { _id, _creationTime, ...stored } = row;
  void _id; void _creationTime;
  const keys = new Set([...Object.keys(stored), ...Object.keys(expected)]);
  return [...keys].every(key => JSON.stringify((stored as Record<string, unknown>)[key]) === JSON.stringify(expected[key]));
}

/** Read-only consistency check: every document of the site has exactly one
 * matching meta row. Reports counts and document ids only. */
export const verifyBatch = internalQuery({
  args: { siteSlug: v.string(), cursor: cursorValidator, numItems: v.optional(v.number()) },
  handler: async (ctx, { siteSlug, cursor, numItems }) => {
    const site = await scopedSite(ctx, siteSlug);
    const page = await ctx.db.query("documents")
      .withIndex("by_site_slug", q => q.eq("siteId", site.siteId))
      .paginate({ cursor: cursor ?? null, numItems: Math.max(1, Math.min(numItems ?? DEFAULT_DOCUMENT_PAGE, 500)), maximumBytesRead: DOCUMENT_PAGE_BYTES });
    const missing: Id<"documents">[] = [];
    const stale: Id<"documents">[] = [];
    const duplicated: Id<"documents">[] = [];
    for (const doc of page.page) {
      const rows = await ctx.db.query("documentMeta").withIndex("by_document", q => q.eq("documentId", doc._id)).collect();
      if (rows.length === 0) missing.push(doc._id);
      else if (rows.length > 1) duplicated.push(doc._id);
      else if (!sameMetadata(rows[0], doc)) stale.push(doc._id);
    }
    return {
      scanned: page.page.length,
      missing: missing.slice(0, 20), missingCount: missing.length,
      stale: stale.slice(0, 20), staleCount: stale.length,
      duplicatedCount: duplicated.length,
      readyAt: site.site.documentMetaReadyAt ?? null,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/** Manual switch. ready:false is the rollback lever; ready:true is for a site
 * backfilled with markReady:false. */
export const setReady = internalMutation({
  args: { siteSlug: v.string(), ready: v.boolean() },
  handler: async (ctx, { siteSlug, ready }) => {
    const site = await scopedSite(ctx, siteSlug);
    const readyAt = ready ? site.site.documentMetaReadyAt ?? Date.now() : undefined;
    await ctx.db.patch(site.siteId, { documentMetaReadyAt: readyAt });
    return { siteSlug, readyAt: readyAt ?? null };
  },
});

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.db.query("sites").collect();
    return sites.map(site => ({ siteSlug: site.slug, status: site.status, readyAt: site.documentMetaReadyAt ?? null }));
  },
});
