import { v } from "convex/values";

export const pathologySlideFields = {
  slideId: v.string(), label: v.string(), stain: v.string(), accession: v.optional(v.string()),
  sourceFileName: v.string(), sourceUri: v.string(), sourceBytes: v.number(), sourceSha256: v.string(),
  width: v.number(), height: v.number(), tileSize: v.number(), overlap: v.number(), maxLevel: v.number(), tileCount: v.number(),
  mppX: v.optional(v.number()), mppY: v.optional(v.number()), objectivePower: v.optional(v.number()),
  scanner: v.string(), scanDate: v.optional(v.string()), colorProfile: v.string(),
  tileManifestUrl: v.string(), tileManifestSha256: v.string(), thumbnailUrl: v.string(),
};

export const pathologyRegionValidator = v.object({
  id: v.string(), kind: v.union(v.literal("region"), v.literal("ruler")),
  x: v.number(), y: v.number(), endX: v.number(), endY: v.number(),
  label: v.string(), note: v.string(), color: v.string(),
});
