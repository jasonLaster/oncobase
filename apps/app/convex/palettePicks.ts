import { v } from "convex/values";
import { mutation } from "./lib/serviceFunctions";
import { requireSite } from "./lib/site";
import { findDocumentMetadata } from "./lib/documentMeta";

/** One file-palette pick: the typed query and the page opened from it. Only
 * the gated application server calls this (service JWT), after checking the
 * reader may open the page. */
export const record = mutation({
  args: {
    siteSlug: v.string(),
    query: v.string(),
    slug: v.string(),
    position: v.number(),
    recommended: v.boolean(),
    recommendedSlugs: v.array(v.string()),
    signedIn: v.boolean(),
  },
  handler: async (ctx, { siteSlug, query, slug, position, recommended, recommendedSlugs, signedIn }) => {
    const site = await requireSite(ctx, siteSlug);
    const { siteId } = site;
    if (!siteId) return;
    const document = await findDocumentMetadata(ctx, site, slug);
    if (!document || document.deletedAt) return;
    await ctx.db.insert("palettePicks", {
      siteId, query: query.trim().slice(0, 200), slug, position: Math.max(0, Math.min(Math.round(position), 1000)),
      recommended, recommendedSlugs: recommendedSlugs.slice(0, 10).map(row => row.slice(0, 400)), signedIn, at: Date.now(),
    });
  },
});
