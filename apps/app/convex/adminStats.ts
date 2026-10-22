/* eslint-disable no-restricted-syntax -- All indexed reads require a resolved siteId. */
import { v } from "convex/values";
import { query } from "./lib/serviceFunctions";
import { requireSite } from "./lib/site";

// Admin dashboard counts. Each query reads one bounded page; the app server
// loops over pages so no single execution approaches Convex read limits.

const BLOCK_REDACTION_RE = /^[\t ]*:::redact\b/gm;
const INLINE_REDACTION_RE = /<redact\b/gi;

/** `:::redact` blocks plus inline `<redact>` tags in the author's source. */
export function countRedactionMarkup(markdown: string) {
  return (markdown.match(BLOCK_REDACTION_RE)?.length ?? 0) + (markdown.match(INLINE_REDACTION_RE)?.length ?? 0);
}

const emptyPage = { page: [], isDone: true, continueCursor: "" };

// Reads bodies, so it is scoped to one slug prefix (a folder such as
// "sources/meeting-notes/") and bounded by bytes as well as rows.
export const redactionPage = query({
  args: { siteSlug: v.string(), prefix: v.string(), cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { siteSlug, prefix, cursor, numItems }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId || !prefix.endsWith("/")) return emptyPage;
    const result = await ctx.db.query("documents")
      .withIndex("by_site_slug", (q) => q.eq("siteId", site.siteId!).gte("slug", prefix).lt("slug", `${prefix}￿`))
      .paginate({ cursor, numItems: Math.min(Math.max(1, numItems), 50), maximumBytesRead: 8_000_000 });
    return {
      page: result.page
        .filter((doc) => !doc.deletedAt)
        .map((doc) => ({
          slug: doc.slug,
          sensitive: doc.sensitive === true,
          redactions: countRedactionMarkup(doc.rawContent ?? doc.content),
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

const countedTable = v.union(
  v.literal("pdfAssets"),
  v.literal("fileAssets"),
  v.literal("dicomSeries"),
  v.literal("dicomImages"),
  v.literal("pathologySlides"),
  v.literal("pageShares"),
  v.literal("commentRooms"),
);

// Live rows of one site-scoped table, one page at a time.
export const countPage = query({
  args: { siteSlug: v.string(), table: countedTable, cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { siteSlug, table, cursor, numItems }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) return { count: 0, threads: 0, isDone: true, continueCursor: "" };
    const siteId = site.siteId;
    const options = { cursor, numItems: Math.min(Math.max(1, numItems), 4000), maximumBytesRead: 8_000_000 };
    const result = await (() => {
      switch (table) {
        case "pdfAssets": return ctx.db.query("pdfAssets").withIndex("by_site_path", (q) => q.eq("siteId", siteId)).paginate(options);
        case "fileAssets": return ctx.db.query("fileAssets").withIndex("by_site_path", (q) => q.eq("siteId", siteId)).paginate(options);
        case "dicomSeries": return ctx.db.query("dicomSeries").withIndex("by_site_series_key", (q) => q.eq("siteId", siteId)).paginate(options);
        case "dicomImages": return ctx.db.query("dicomImages").withIndex("by_site_path", (q) => q.eq("siteId", siteId)).paginate(options);
        case "pathologySlides": return ctx.db.query("pathologySlides").withIndex("by_site_slide", (q) => q.eq("siteId", siteId)).paginate(options);
        case "pageShares": return ctx.db.query("pageShares").withIndex("by_site_token", (q) => q.eq("siteId", siteId)).paginate(options);
        case "commentRooms": return ctx.db.query("commentRooms").withIndex("by_site_room", (q) => q.eq("siteId", siteId)).paginate(options);
      }
    })();
    const live = (result.page as Array<{ deletedAt?: number; revokedAt?: number; threadCount?: number }>)
      .filter((row) => !row.deletedAt && !row.revokedAt);
    // Comment rooms are per page; their threadCount is the number people see.
    const threads = live.reduce((sum, row) => sum + (row.threadCount ?? 0), 0);
    return { count: live.length, threads, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
