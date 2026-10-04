import { v } from "convex/values";
import { serviceOrSecretMutation, serviceOrSecretQuery } from "./lib/serviceFunctions";
import { requireSite } from "./lib/site";
import { addVisit } from "./lib/prefetchPriority";
import { findDocumentMetadata } from "./lib/documentMeta";

// Only the gated application server can call these functions (service JWT;
// legacy `serverSecret` accepted for one deploy). Access filtering happens
// again before HTTP responses.
const args = { siteSlug: v.string(), serverSecret: v.optional(v.string()) };

export const recordVisit = serviceOrSecretMutation({
  args: { ...args, slug: v.string() },
  handler: async (ctx, { siteSlug, slug }) => {
    const site = await requireSite(ctx, siteSlug);
    const { siteId } = site;
    if (!siteId) return;
    // Scoped by the resolved siteId; body-free once the site is backfilled.
    const document = await findDocumentMetadata(ctx, site, slug);
    if (!document || document.deletedAt) return;
    // eslint-disable-next-line no-restricted-syntax -- Same resolved siteId and slug; never query another site's visit row.
    const previous = await ctx.db.query("pageVisitStats").withIndex("by_site_slug", q => q.eq("siteId", siteId).eq("slug", slug)).first();
    const now = Date.now();
    // Coalesce reloads and concurrent readers within a minute. This is an
    // aggregate popularity signal, not an exact analytics/page-view counter.
    if (previous && now - previous.lastVisitedAt < 60_000) return;
    const values = { priority: addVisit(previous?.priority, now), lastVisitedAt: now };
    if (previous) await ctx.db.patch(previous._id, values);
    else await ctx.db.insert("pageVisitStats", { siteId, slug, ...values });
  },
});

export const priorities = serviceOrSecretQuery({
  args,
  handler: async (ctx, { siteSlug }) => {
    const siteCtx = await requireSite(ctx, siteSlug);
    const { siteId, site } = siteCtx;
    if (!siteId) return [];
    // eslint-disable-next-line no-restricted-syntax -- Bound ranked reads to the resolved site's compound index.
    const ranked = await ctx.db.query("pageVisitStats").withIndex("by_site_priority", q => q.eq("siteId", siteId)).order("desc").take(300);
    // A new site has no visit history yet. Use its existing curated seeds as
    // the tail of the list rather than arbitrarily downloading the corpus.
    const slugs = [...new Set([...ranked.map(row => row.slug), ...(site?.config.previewSeedSlugs ?? ["index"])])].slice(0, 320);
    // Up to 320 lookups: before the documentMeta backfill each reads a whole
    // stored row, afterwards only the small projection.
    const candidates = await Promise.all(slugs.map(async slug => {
      // Recheck deletion/visibility within this site, not a global slug index.
      const doc = await findDocumentMetadata(ctx, siteCtx, slug);
      return doc && !doc.deletedAt ? { slug: doc.slug, sensitive: doc.sensitive === true } : null;
    }));
    return candidates.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});
