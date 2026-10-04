import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { PUBLISH_LEASE_MS } from "./publishRun";

const runId = "scoped:11111111-1111-1111-1111-111111111111";
const other = "scoped:22222222-2222-2222-2222-222222222222";

async function fixture() {
  const t = convexTest(schema, {
    "../documents.ts": () => import("../documents"),
    "../sites.ts": () => import("../sites"),
    "../_generated/server.js": () => import("../_generated/server"),
  }).withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  const siteId = await t.run(ctx => ctx.db.insert("sites", {
    slug: "fixture", name: "fixture", ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
    config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
    quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
  }));
  const site = () => t.run(ctx => ctx.db.get(siteId));
  const expiryJobs = async () => (await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect()))
    .filter(job => job.name.includes("expirePublish") && job.state.kind === "pending").length;
  const write = () => t.mutation(api.documents.upsert, { siteSlug: "fixture", runId, slug: "doc", title: "doc", content: "body", contentHash: "hash", tags: [] });
  await t.mutation(api.sites.beginPublish, { slug: "fixture", runId, scope: { documents: ["doc"], assets: [] } });
  return { t, siteId, site, expiryJobs, write };
}

test("a live owned lease can be renewed; the stale expiry check then leaves it alone", async () => {
  const { t, siteId, site, expiryJobs, write } = await fixture();
  expect(await expiryJobs()).toBe(1);
  // Nearly expired: the original 10-minute lease is about to run out.
  await t.run(ctx => ctx.db.patch(siteId, { publishLockUntil: Date.now() + 1_000 }));
  const before = Date.now();
  const { lockUntil } = await t.mutation(api.sites.renewPublish, { slug: "fixture", runId });
  expect(lockUntil).toBeGreaterThanOrEqual(before + PUBLISH_LEASE_MS);
  expect((await site())!.publishLockUntil).toBe(lockUntil);
  expect(await expiryJobs()).toBe(2);

  // Back-to-back renewals do not rewrite the shared site row or add jobs.
  expect((await t.mutation(api.sites.renewPublish, { slug: "fixture", runId })).lockUntil).toBe(lockUntil);
  expect(await expiryJobs()).toBe(2);

  // The original expiry job fires while the renewed lease is still live.
  await t.mutation(internal.sites.expirePublish, { slug: "fixture", runId });
  expect((await site())!.publishRunId).toBe(runId);
  expect((await site())!.lastPublishStatus).toBe("running");
  expect(await write()).toEqual({ skipped: false });
});

test("only the owning run can renew, and never after its lease expired", async () => {
  const { t, siteId, site, write } = await fixture();
  await expect(t.mutation(api.sites.renewPublish, { slug: "fixture", runId: other })).rejects.toThrow("does not own");
  await expect(t.mutation(api.sites.renewPublish, { slug: "fixture", runId: "legacy-run" })).rejects.toThrow("invalid run identity");

  await t.run(ctx => ctx.db.patch(siteId, { publishLockUntil: Date.now() - 1 }));
  await expect(t.mutation(api.sites.renewPublish, { slug: "fixture", runId })).rejects.toThrow("lease expired");
  await expect(write()).rejects.toThrow("lease expired");
  // The expiry check finalizes the abandoned run.
  await t.mutation(internal.sites.expirePublish, { slug: "fixture", runId });
  expect((await site())!.publishRunId).toBeUndefined();
  expect((await site())!.lastPublishStatus).toBe("failed");
  // A successor may take over and its own renewal works.
  await t.mutation(api.sites.beginPublish, { slug: "fixture", runId: other, scope: { documents: [], assets: [] } });
  await expect(t.mutation(api.sites.renewPublish, { slug: "fixture", runId })).rejects.toThrow("does not own");
  await t.run(ctx => ctx.db.patch(siteId, { publishLockUntil: Date.now() + 1_000 }));
  expect((await t.mutation(api.sites.renewPublish, { slug: "fixture", runId: other })).lockUntil).toBeGreaterThan(Date.now() + 1_000);
});
