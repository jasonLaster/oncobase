/* eslint-disable no-restricted-syntax */
import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";

type AnyCtx = QueryCtx | MutationCtx;

const annotationValidator = v.object({
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
});

async function findImageAnnotationSet(
  ctx: AnyCtx,
  site: SiteCtx,
  seriesKey: string,
  imageKey: string,
) {
  if (!site.siteId) return null;
  const row = await ctx.db
    .query("imageAnnotations")
    .withIndex("by_site_image", (q) =>
      q.eq("siteId", site.siteId!).eq("seriesKey", seriesKey).eq("imageKey", imageKey),
    )
    .first();
  return row && rowBelongsToSite(row, site) ? row : null;
}

export const listForSeries = query({
  args: {
    siteSlug: v.optional(v.string()),
    seriesKey: v.string(),
  },
  handler: async (ctx, { siteSlug, seriesKey }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) return [];

    const rows = await ctx.db
      .query("imageAnnotations")
      .withIndex("by_site_series", (q) =>
        q.eq("siteId", site.siteId!).eq("seriesKey", seriesKey),
      )
      .collect();

    return rows
      .filter((row) => rowBelongsToSite(row, site))
      .sort((a, b) => a.imagePath.localeCompare(b.imagePath, undefined, { numeric: true }))
      .map((row) => ({
        imageKey: row.imageKey,
        imagePath: row.imagePath,
        annotations: row.annotations,
        updatedAt: row.updatedAt,
      }));
  },
});

export const saveForImage = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    seriesKey: v.string(),
    imageKey: v.string(),
    imagePath: v.string(),
    annotations: v.array(annotationValidator),
  },
  handler: async (ctx, { siteSlug, seriesKey, imageKey, imagePath, annotations }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) {
      throw new Error(`site ${site.siteSlug} not found`);
    }

    const now = Date.now();
    const existing = await findImageAnnotationSet(ctx, site, seriesKey, imageKey);
    if (existing) {
      await ctx.db.patch(existing._id, {
        annotations,
        imagePath,
        siteId: site.siteId,
        updatedAt: now,
      });
      return { updatedAt: now };
    }

    await ctx.db.insert("imageAnnotations", {
      siteId: site.siteId,
      seriesKey,
      imageKey,
      imagePath,
      annotations,
      createdAt: now,
      updatedAt: now,
    });
    return { updatedAt: now };
  },
});
