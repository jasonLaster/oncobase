import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";

test("owned publish writes stay in scope, coalesce invalidation, and reject old writers/abort/finish", async () => {
  const t = convexTest(schema, {
    "../documents.ts": () => import("../documents"),
    "../sites.ts": () => import("../sites"),
    "../_generated/server.js": () => import("../_generated/server"),
  }).withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  const siteId = await t.run(ctx => ctx.db.insert("sites", {
    slug: "fixture", name: "fixture", ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
    config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
    quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
    manifestRevision: 10, manifestBuildQueuedAt: Date.now(),
  }));
  const site = () => t.run(ctx => ctx.db.get(siteId));
  const runId = "scoped:11111111-1111-1111-1111-111111111111";
  const newer = "scoped:22222222-2222-2222-2222-222222222222";
  const scope = { documents: ["first", "second"], assets: ["file:shared.png"] };
  const write = (slug: string, id: string | undefined = runId) => t.mutation(api.documents.upsert, {
    siteSlug: "fixture", runId: id, slug, title: slug, content: "body", rawContent: "body", contentHash: "hash", tags: [],
  });
  await t.mutation(api.sites.beginPublish, { slug: "fixture", runId, scope });
  await t.mutation(api.sites.beginPublish, { slug: "fixture", runId, scope }); // same-run retry
  await expect(t.mutation(api.sites.beginPublish, { slug: "fixture", runId, scope: { ...scope, documents: ["unreviewed"] } })).rejects.toThrow("already running");
  await expect(write("outside")).rejects.toThrow("outside the run scope");
  await expect(write("first", "legacy-run")).rejects.toThrow("does not own");
  await write("first");
  await write("second");
  await t.mutation(api.documents.upsert, { siteSlug: "fixture", runId, slug: "second", title: "second", content: "replacement", contentHash: "replacement-hash", tags: [], replaceRawContent: true });
  const withoutRaw = await t.query(api.documents.publisherState, { siteSlug: "fixture", slugs: ["second"], assets: [] });
  expect(withoutRaw.documents[0].observedHash).toBeNull();
  await t.mutation(api.documents.upsertFileAsset, { siteSlug: "fixture", runId, path: "shared.png", blobUrl: "https://example.test/hash/shared.png", sizeBytes: 5 });
  expect((await site())!.manifestRevision).toBe(10); // no shared manifest writes per worker
  await expect(t.mutation(api.documents.deleteBySlug, { siteSlug: "fixture", slug: "first" })).rejects.toThrow("does not own");
  await expect(t.mutation(api.sites.failPublish, { slug: "fixture", error: "late", runId: newer })).rejects.toThrow("does not own");
  await t.mutation(api.sites.finishPublish, { slug: "fixture", runId });
  expect((await site())!.manifestRevision).toBe(11);
  expect((await site())!.publishRunId).toBeUndefined();
  await expect(write("first")).rejects.toThrow("does not own");
  await expect(t.mutation(api.documents.upsertEmbedding, { siteSlug: "fixture", runId, slug: "first", embedding: [] })).rejects.toThrow("does not own");

  await t.mutation(api.sites.beginPublish, { slug: "fixture", runId: newer, scope });
  expect(await write("first", newer)).toEqual({ skipped: true });
  expect((await site())!.publishRunChanged).toBe(false);
  await expect(t.mutation(api.sites.finishPublish, { slug: "fixture", runId })).rejects.toThrow("does not own");
  await expect(t.mutation(api.sites.failPublish, { slug: "fixture", runId, error: "late abort" })).rejects.toThrow("does not own");
  await t.mutation(internal.sites.expirePublish, { slug: "fixture", runId });
  expect((await site())!.publishRunId).toBe(newer);
  await t.mutation(api.documents.setContentHash, { siteSlug: "fixture", runId: (await site())!.publishRunId, slug: "first", contentHash: `changed-${(await site())!.manifestRevision}` });
  await t.run(ctx => ctx.db.patch(siteId, { publishLockUntil: Date.now() - 1 }));
  await expect(write("first", newer)).rejects.toThrow("lease expired");
  await t.mutation(api.sites.failPublish, { slug: "fixture", runId: newer, error: "abort expired own run" });
  expect((await site())!.manifestRevision).toBe(12); // partial writes are made visible on abort too
  expect((await site())!.lastPublishStatus).toBe("failed");
  await t.mutation(api.sites.beginPublish, { slug: "fixture", runId, scope });
  await t.mutation(api.documents.setContentHash, { siteSlug: "fixture", runId: (await site())!.publishRunId, slug: "first", contentHash: `changed-${(await site())!.manifestRevision}` });
  await t.run(ctx => ctx.db.patch(siteId, { publishLockUntil: Date.now() - 1 }));
  await t.mutation(internal.sites.expirePublish, { slug: "fixture", runId });
  expect((await site())!.publishRunId).toBeUndefined();
  expect((await site())!.manifestRevision).toBe(13);
  // Each independent write route must mark a fresh run; a preceding document
  // write must not hide a missing asset/backfill marker.
  const mutations = [
    () => t.mutation(api.documents.upsertFileAsset, { siteSlug: "fixture", runId, path: "shared.png", blobUrl: "https://example.test/new.png", sizeBytes: 6 }),
    () => t.mutation(api.documents.upsertPdfAsset, { siteSlug: "fixture", runId, path: "shared.pdf", blobUrl: "https://example.test/new.pdf", sizeBytes: 6 }),
    () => t.mutation(api.documents.bulkSetContentHash, { siteSlug: "fixture", runId, entries: [{ slug: "first", contentHash: "bulk-changed" }] }),
    () => t.mutation(api.documents.backfillAssetHashes, { siteSlug: "fixture", runId, entries: [{ kind: "file", path: "shared.png", contentHash: "asset-changed", ownerSlugs: ["first"], sensitive: true, sensitiveInclude: ["team"], visibilityHash: "visibility-changed" }] }),
  ];
  for (const mutate of mutations) {
    const revision = (await site())!.manifestRevision!;
    await t.mutation(api.sites.beginPublish, { slug: "fixture", runId, scope: { ...scope, assets: [...scope.assets, "pdf:shared.pdf"] } });
    await mutate();
    expect((await site())!.publishRunChanged).toBe(true);
    expect((await site())!.manifestRevision).toBe(revision);
    expect(await t.mutation(api.sites.finishPublish, { slug: "fixture", runId })).toEqual({ revision: revision + 1 });
  }
  await t.run(async ctx => { for (const job of await ctx.db.system.query("_scheduled_functions").collect()) await ctx.scheduler.cancel(job._id); });
});


test("owned no-ops preserve revisions; missing snapshots rebuild and old runs invalidate conservatively", async () => {
  const t = convexTest(schema, {
    "../documents.ts": () => import("../documents"),
    "../sites.ts": () => import("../sites"),
    "../_generated/server.js": () => import("../_generated/server"),
  }).withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  const id = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["snapshot"]));
    return ctx.db.insert("sites", {
      slug: "fixture", name: "fixture", ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
      manifestRevision: 10, manifestSnapshot: { revision: 10, formatVersion: 1, storageId, hash: "snapshot" },
    });
  });
  const site = () => t.run(ctx => ctx.db.get(id));
  const runId = "scoped:no-op", scope = { documents: ["first"], assets: [] };
  const begin = () => t.mutation(api.sites.beginPublish, { slug: "fixture", runId, scope });
  const finish = () => t.mutation(api.sites.finishPublish, { slug: "fixture", runId });
  const snapshot = (await site())!.manifestSnapshot;
  await begin();
  expect((await site())!.publishRunChanged).toBe(false);
  expect(await finish()).toEqual({ revision: 10 });
  expect((await site())!.manifestSnapshot).toEqual(snapshot);
  expect((await site())!.manifestBuildQueuedAt).toBeUndefined();
  expect((await site())!.publishRunChanged).toBeUndefined();
  await begin();
  await t.mutation(api.sites.failPublish, { slug: "fixture", runId, error: "unchanged abort" });
  expect((await site())!.manifestRevision).toBe(10);
  await begin();
  await t.run(ctx => ctx.db.patch(id, { publishLockUntil: Date.now() - 1 }));
  await t.mutation(internal.sites.expirePublish, { slug: "fixture", runId });
  expect((await site())!.manifestRevision).toBe(10);
  // Missing storage bytes also force repair even with matching metadata.
  await t.run(ctx => ctx.storage.delete(snapshot!.storageId));
  await begin();
  expect(await finish()).toEqual({ revision: 10 });
  expect((await site())!.manifestBuildQueuedAt).toBeNumber();
  await t.run(ctx => ctx.db.patch(id, { manifestBuildQueuedAt: undefined }));
  // A revision changed elsewhere cannot use the old snapshot.
  await t.run(ctx => ctx.db.patch(id, { manifestRevision: 11 }));
  await begin();
  expect(await finish()).toEqual({ revision: 11 });
  expect((await site())!.manifestBuildQueuedAt).toBeNumber();
  // A run started before change tracking shipped must rebuild even if no
  // mutation in this process was observed.
  await begin();
  await t.run(ctx => ctx.db.patch(id, { publishRunChanged: undefined }));
  expect(await finish()).toEqual({ revision: 12 });
  await t.run(async ctx => { for (const job of await ctx.db.system.query("_scheduled_functions").collect()) await ctx.scheduler.cancel(job._id); });
});
