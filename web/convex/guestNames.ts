import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";

type AnyCtx = QueryCtx | MutationCtx;

async function findGuest(ctx: AnyCtx, site: SiteCtx, guestId: string) {
  const siteId = site.siteId;
  if (siteId) {
    const scoped = await ctx.db
      .query("guestNames")
      .withIndex("by_site_guest", (q) => q.eq("siteId", siteId).eq("guestId", guestId))
      .first();
    if (scoped) return scoped;
  }
  const legacy = await ctx.db
    .query("guestNames")
    .withIndex("by_guest_id", (q) => q.eq("guestId", guestId))
    .first();
  if (legacy && rowBelongsToSite(legacy, site)) return legacy;
  return null;
}

export const upsert = mutation({
  args: { guestId: v.string(), name: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { guestId, name, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const existing = await findGuest(ctx, site, guestId);
    if (existing) {
      if (existing.name !== name) {
        await ctx.db.patch(existing._id, { name, updatedAt: Date.now() });
      }
      return existing._id;
    }
    return await ctx.db.insert("guestNames", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      guestId,
      name,
      updatedAt: Date.now(),
    });
  },
});

export const getByIds = query({
  args: { guestIds: v.array(v.string()), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { guestIds, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const results: Record<string, string> = {};
    for (const guestId of guestIds) {
      const row = await findGuest(ctx, site, guestId);
      if (row) {
        results[guestId] = row.name;
      }
    }
    return results;
  },
});
