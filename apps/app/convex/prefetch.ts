import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSite } from "./lib/site";
import { addVisit, requirePrefetchSecret } from "./lib/prefetchPriority";

// Only the gated application server can call these functions. The key is never
// sent to a browser. Access filtering happens again before HTTP responses.
const args = { siteSlug: v.string(), serverSecret: v.string() };

export const recordVisit = mutation({
  args: { ...args, slug: v.string() },
  handler: async (ctx, { siteSlug, serverSecret, slug }) => {
    requirePrefetchSecret(serverSecret, process.env.WIKI_PREFETCH_SECRET);
    const { siteId } = await requireSite(ctx, siteSlug);
    if (!siteId) return;
    // eslint-disable-next-line no-restricted-syntax -- requireSite resolved above; indexed equality enforces tenant scope (tested).
    const document = await ctx.db.query("documents").withIndex("by_site_slug", q => q.eq("siteId", siteId).eq("slug", slug)).first();
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

export const priorities = query({
  args,
  handler: async (ctx, { siteSlug, serverSecret }) => {
    requirePrefetchSecret(serverSecret, process.env.WIKI_PREFETCH_SECRET);
    const { siteId, site } = await requireSite(ctx, siteSlug);
    if (!siteId) return [];
    // eslint-disable-next-line no-restricted-syntax -- Bound ranked reads to the resolved site's compound index.
    const ranked = await ctx.db.query("pageVisitStats").withIndex("by_site_priority", q => q.eq("siteId", siteId)).order("desc").take(300);
    // A new site has no visit history yet. Use its existing curated seeds as
    // the tail of the list rather than arbitrarily downloading the corpus.
    const slugs = [...new Set([...ranked.map(row => row.slug), ...(site?.config.previewSeedSlugs ?? ["index"])])].slice(0, 320);
    const candidates = await Promise.all(slugs.map(async slug => {
      // eslint-disable-next-line no-restricted-syntax -- Recheck deletion/visibility within this site, not a global slug index.
      const doc = await ctx.db.query("documents").withIndex("by_site_slug", q => q.eq("siteId", siteId).eq("slug", slug)).first();
      return doc && !doc.deletedAt ? { slug: doc.slug, sensitive: doc.sensitive === true } : null;
    }));
    return candidates.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});
