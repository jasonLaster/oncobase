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
  await expect(t.mutation(api.sites.finishPublish, { slug: "fixture", runId })).rejects.toThrow("does not own");
  await expect(t.mutation(api.sites.failPublish, { slug: "fixture", runId, error: "late abort" })).rejects.toThrow("does not own");
  await t.mutation(internal.sites.expirePublish, { slug: "fixture", runId });
  expect((await site())!.publishRunId).toBe(newer);
  await t.run(ctx => ctx.db.patch(siteId, { publishLockUntil: Date.now() - 1 }));
  await expect(write("first", newer)).rejects.toThrow("lease expired");
  await t.mutation(api.sites.failPublish, { slug: "fixture", runId: newer, error: "abort expired own run" });
  expect((await site())!.manifestRevision).toBe(12); // partial writes are made visible on abort too
  expect((await site())!.lastPublishStatus).toBe("failed");
  await t.mutation(api.sites.beginPublish, { slug: "fixture", runId, scope });
  await t.run(ctx => ctx.db.patch(siteId, { publishLockUntil: Date.now() - 1 }));
  await t.mutation(internal.sites.expirePublish, { slug: "fixture", runId });
  expect((await site())!.publishRunId).toBeUndefined();
  expect((await site())!.manifestRevision).toBe(13);
});
