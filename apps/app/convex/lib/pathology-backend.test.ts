import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";

const modules = { "../pathology.ts": () => import("../pathology"), "../_generated/server.js": () => import("../_generated/server") };
const slide = { slideId: `he-${"a".repeat(20)}`, label: "Synthetic H&E", stain: "H&E", sourceFileName: "fixture.svs", sourceUri: "s3://fixture/fixture.svs", sourceBytes: 100,
  sourceSha256: "a".repeat(64), width: 1024, height: 512, tileSize: 1024, overlap: 1, maxLevel: 10, tileCount: 11,
  scanner: "Synthetic", colorProfile: "sRGB", tileManifestUrl: "https://fixture.public.blob.vercel-storage.com/tiles.json", tileManifestSha256: "b".repeat(64), thumbnailUrl: "https://fixture.public.blob.vercel-storage.com/thumb.jpg" };

test("pathology reads require service auth and keep every slide and region tenant scoped", async () => {
  const unauthed = convexTest(schema, modules);
  const t = unauthed.withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  await t.run(async ctx => {
    for (const slug of ["alpha", "beta"]) await ctx.db.insert("sites", { slug, name: slug, ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1 });
  });
  await expect(unauthed.query(api.pathology.list, { siteSlug: "alpha" })).rejects.toThrow("Unauthorized");
  await t.mutation(api.pathology.upsert, { siteSlug: "alpha", slide });
  expect(await t.query(api.pathology.get, { siteSlug: "beta", slideId: slide.slideId })).toBeNull();
  expect(await t.query(api.pathology.list, { siteSlug: "alpha" })).toHaveLength(1);
  const region = { id: "one", kind: "region" as const, x: 10, y: 10, endX: 100, endY: 100, label: "Area", note: "Review", color: "#eab308" };
  const args = { siteSlug: "alpha", slideId: slide.slideId, sourceSha256: slide.sourceSha256, expectedVersion: 0, regions: [region] };
  expect(await t.mutation(api.pathology.saveRegions, args)).toEqual({ conflict: false, version: 1 });
  expect(await t.mutation(api.pathology.saveRegions, { ...args, regions: [] })).toEqual({ conflict: true, version: 1 });
  expect((await t.query(api.pathology.regions, { siteSlug: "alpha", slideId: slide.slideId }))?.regions).toHaveLength(1);
  expect(await t.query(api.pathology.regions, { siteSlug: "beta", slideId: slide.slideId })).toBeNull();
  await expect(t.mutation(api.pathology.saveRegions, { ...args, sourceSha256: "c".repeat(64) })).rejects.toThrow("Slide source changed");
  await expect(t.mutation(api.pathology.saveRegions, { ...args, expectedVersion: 1, regions: [{ ...region, endX: 2048 }] })).rejects.toThrow("Invalid region geometry");
});
