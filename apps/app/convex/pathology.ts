/* eslint-disable no-restricted-syntax */
import { ConvexError, v } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx } from "./lib/serviceFunctions";
import { requireSite } from "./lib/site";
import { pathologySlideFields, pathologyRegionValidator } from "./lib/pathologyModel";
import type { Id } from "./_generated/dataModel";

async function findSlide(ctx: QueryCtx | MutationCtx, siteId: Id<"sites">, slideId: string) {
  return ctx.db.query("pathologySlides").withIndex("by_site_slide", q => q.eq("siteId", siteId).eq("slideId", slideId)).unique();
}

export const list = query({
  args: { siteSlug: v.string() },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) return [];
    return (await ctx.db.query("pathologySlides").withIndex("by_site_slide", q => q.eq("siteId", site.siteId!)).collect())
      .filter(row => !row.deletedAt).sort((a, b) => a.label.localeCompare(b.label));
  },
});

export const get = query({
  args: { siteSlug: v.string(), slideId: v.string() },
  handler: async (ctx, { siteSlug, slideId }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) return null;
    const slide = await findSlide(ctx, site.siteId, slideId);
    return slide && !slide.deletedAt ? slide : null;
  },
});

export const upsert = mutation({
  args: { siteSlug: v.string(), slide: v.object(pathologySlideFields) },
  handler: async (ctx, { siteSlug, slide }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) throw new ConvexError("Site not found");
    if (!/^[a-f0-9]{64}$/.test(slide.sourceSha256) || !/^[a-f0-9]{64}$/.test(slide.tileManifestSha256)
      || !/^he-[a-f0-9]{20}$/.test(slide.slideId) || slide.slideId !== `he-${slide.sourceSha256.slice(0, 20)}`) {
      throw new ConvexError("Invalid source identity");
    }
    for (const value of [slide.width, slide.height, slide.tileSize, slide.tileCount]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new ConvexError("Invalid slide dimensions");
    }
    const existing = await findSlide(ctx, site.siteId, slide.slideId);
    if (existing && existing.sourceSha256 !== slide.sourceSha256) throw new ConvexError("Source identity cannot change");
    const fields = { ...slide, siteId: site.siteId, updatedAt: Date.now(), deletedAt: undefined };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("pathologySlides", { ...fields, createdAt: Date.now() });
    return { slideId: slide.slideId };
  },
});

export const regions = query({
  args: { siteSlug: v.string(), slideId: v.string() },
  handler: async (ctx, { siteSlug, slideId }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId || !(await findSlide(ctx, site.siteId, slideId))) return null;
    return await ctx.db.query("pathologyRegions").withIndex("by_site_slide", q => q.eq("siteId", site.siteId!).eq("slideId", slideId)).unique();
  },
});

export const saveRegions = mutation({
  args: { siteSlug: v.string(), slideId: v.string(), sourceSha256: v.string(), expectedVersion: v.number(), regions: v.array(pathologyRegionValidator) },
  handler: async (ctx, { siteSlug, slideId, sourceSha256, expectedVersion, regions }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) throw new ConvexError("Site not found");
    const slide = await findSlide(ctx, site.siteId, slideId);
    if (!slide || slide.deletedAt || slide.sourceSha256 !== sourceSha256) throw new ConvexError("Slide source changed or unavailable");
    if (regions.length > 200 || new Set(regions.map(r => r.id)).size !== regions.length) throw new ConvexError("Invalid region collection");
    for (const region of regions) {
      if (!region.id || region.label.length > 160 || region.note.length > 4000 || !/^#[a-fA-F0-9]{6}$/.test(region.color)
        || ![region.x, region.endX].every(n => Number.isFinite(n) && n >= 0 && n <= slide.width)
        || ![region.y, region.endY].every(n => Number.isFinite(n) && n >= 0 && n <= slide.height)) {
        throw new ConvexError("Invalid region geometry or note");
      }
    }
    const existing = await ctx.db.query("pathologyRegions").withIndex("by_site_slide", q => q.eq("siteId", site.siteId!).eq("slideId", slideId)).unique();
    if ((existing?.version ?? 0) !== expectedVersion) return { conflict: true as const, version: existing?.version ?? 0 };
    const version = expectedVersion + 1;
    const fields = { siteId: site.siteId, slideId, sourceSha256, regions, version, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("pathologyRegions", fields);
    return { conflict: false as const, version };
  },
});
