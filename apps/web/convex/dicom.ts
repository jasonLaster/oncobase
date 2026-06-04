/* eslint-disable no-restricted-syntax */
import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";

type AnyCtx = QueryCtx | MutationCtx;

async function findSeriesByKey(ctx: AnyCtx, site: SiteCtx, seriesKey: string) {
  if (site.siteId) {
    const scoped = await ctx.db
      .query("dicomSeries")
      .withIndex("by_site_series_key", (q) =>
        q.eq("siteId", site.siteId!).eq("seriesKey", seriesKey),
      )
      .first();
    if (scoped) return scoped;
  }

  const legacy = await ctx.db
    .query("dicomSeries")
    .withIndex("by_series_key", (q) => q.eq("seriesKey", seriesKey))
    .first();
  if (legacy && rowBelongsToSite(legacy, site)) return legacy;
  return null;
}

async function findImageByPath(ctx: AnyCtx, site: SiteCtx, path: string) {
  if (site.siteId) {
    const scoped = await ctx.db
      .query("dicomImages")
      .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!).eq("path", path))
      .first();
    if (scoped) return scoped;
  }

  const legacy = await ctx.db
    .query("dicomImages")
    .withIndex("by_path", (q) => q.eq("path", path))
    .first();
  if (legacy && rowBelongsToSite(legacy, site)) return legacy;
  return null;
}

const optionalString = v.optional(v.string());
const optionalNumber = v.optional(v.number());

export const listSeries = query({
  args: {
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) return [];

    const seriesRows = await ctx.db
      .query("dicomSeries")
      .withIndex("by_site_updated", (q) => q.eq("siteId", site.siteId!))
      .collect();

    const activeSeries = seriesRows
      .filter((row) => rowBelongsToSite(row, site) && !row.deletedAt)
      .sort(
        (a, b) =>
          (b.studyDate ?? "").localeCompare(a.studyDate ?? "") ||
          (a.seriesNumber ?? Number.MAX_SAFE_INTEGER) -
            (b.seriesNumber ?? Number.MAX_SAFE_INTEGER) ||
          a.relativeDirectory.localeCompare(b.relativeDirectory),
      );

    const result = [];
    for (const row of activeSeries) {
      const images = await ctx.db
        .query("dicomImages")
        .withIndex("by_site_series", (q) =>
          q.eq("siteId", site.siteId!).eq("seriesKey", row.seriesKey),
        )
        .collect();

      result.push({
        ...row,
        images: images
          .filter((image) => rowBelongsToSite(image, site) && !image.deletedAt)
          .sort(
            (a, b) =>
              (a.imagePosition ?? a.instanceNumber ?? Number.MAX_SAFE_INTEGER) -
                (b.imagePosition ?? b.instanceNumber ?? Number.MAX_SAFE_INTEGER) ||
              a.path.localeCompare(b.path, undefined, { numeric: true }),
          ),
      });
    }

    return result;
  },
});

export const getImageByPath = query({
  args: {
    siteSlug: v.optional(v.string()),
    path: v.string(),
  },
  handler: async (ctx, { siteSlug, path }) => {
    const site = await requireSite(ctx, siteSlug);
    const image = await findImageByPath(ctx, site, path);
    if (!image || image.deletedAt) return null;
    return image;
  },
});

export const upsertSeriesWithImages = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    series: v.object({
      seriesKey: v.string(),
      label: v.string(),
      relativeDirectory: v.string(),
      modality: optionalString,
      studyDescription: optionalString,
      seriesDescription: optionalString,
      studyDate: optionalString,
      seriesNumber: optionalNumber,
    }),
    images: v.array(
      v.object({
        path: v.string(),
        fileName: v.string(),
        blobUrl: v.string(),
        sizeBytes: v.number(),
        contentHash: optionalString,
        instanceNumber: optionalNumber,
        imagePosition: optionalNumber,
        rows: optionalNumber,
        columns: optionalNumber,
      }),
    ),
  },
  handler: async (ctx, { siteSlug, series, images }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) {
      throw new Error(`site ${site.siteSlug} not found`);
    }

    const now = Date.now();
    const existingSeries = await findSeriesByKey(ctx, site, series.seriesKey);
    if (existingSeries) {
      await ctx.db.patch(existingSeries._id, {
        ...series,
        siteId: site.siteId,
        imageCount: images.length,
        updatedAt: now,
        deletedAt: undefined,
      });
    } else {
      await ctx.db.insert("dicomSeries", {
        ...series,
        siteId: site.siteId,
        imageCount: images.length,
        uploadedAt: now,
        updatedAt: now,
      });
    }

    let upsertedImages = 0;
    for (const image of images) {
      const existingImage = await findImageByPath(ctx, site, image.path);
      if (existingImage) {
        await ctx.db.patch(existingImage._id, {
          ...image,
          siteId: site.siteId,
          seriesKey: series.seriesKey,
          uploadedAt: now,
          deletedAt: undefined,
        });
      } else {
        await ctx.db.insert("dicomImages", {
          ...image,
          siteId: site.siteId,
          seriesKey: series.seriesKey,
          uploadedAt: now,
        });
      }
      upsertedImages += 1;
    }

    return { upsertedImages };
  },
});
