// Contract: a manifest `known` token (P6) can only stay the same while what
// the user may read stays the same. A missed invalidation would let a reader
// keep a manifest that lists pages they can no longer read, so:
//
//  1. Inventory. Every exported mutation in convex/ is classified here as
//     bumping accessRevision, bumping manifestRevision/snapshot/publish state,
//     or as unable to change what a signed-in reader's manifest contains (with
//     the reason). A new mutation fails this test until someone classifies it.
//  2. Each "access" and "manifest" mutation, run for real, changes the token
//     (or makes it unusable while a publisher holds the site).
//  3. A randomized sequence of access, content and unrelated mutations never
//     leaves the token unchanged while the user's readable set changed.
//  4. The one-transaction overlay equals the old chain of queries.
//  5. The policy code is fingerprinted, so changing it forces a decision about
//     ACCESS_POLICY_VERSION (part of every token).
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { MANIFEST_SNAPSHOT_VERSION } from "./manifestRevision";
import { ACCESS_POLICY_VERSION } from "./accessRevision";

const CONVEX_DIR = path.resolve(import.meta.dir, "..");
const moduleFiles = [...new Bun.Glob("*.ts").scanSync(CONVEX_DIR)]
  .filter(file => !file.endsWith(".test.ts") && !readFileSync(path.join(CONVEX_DIR, file), "utf8").startsWith('"use node"'));
const modules: Record<string, () => Promise<unknown>> = {
  "../_generated/server.js": () => import("../_generated/server"),
  ...Object.fromEntries(moduleFiles.map(file => [`../${file}`, () => import(path.join(CONVEX_DIR, file))])),
};

type Effect = "access" | "manifest" | { none: string };
const NO_MANIFEST_DATA = { none: "writes no table a manifest or an access rule reads" };
// module:export -> what it can do to a signed-in reader's manifest.
const MUTATIONS: Record<string, Effect> = {
  // Who can read what: accessRevision, same transaction.
  "access:createRole": "access",
  "access:updateRole": "access",
  "access:deleteRole": "access",
  "access:assignRoleToUser": "access",
  "access:setRoleForUser": "access",
  "access:setRoleForUsers": "access",
  "access:deleteUsers": "access",
  "users:create": "access",
  "sites:ensureDiana": "access",
  "sites:archive": "access",
  "sites:restore": "access",
  "documentMeta:backfillBatch": "access",
  "documentMeta:setReady": "access",
  "migrations:backfillSiteIdsBatch": "access",
  // Content, sensitivity and asset visibility: manifestRevision (same
  // transaction for unowned writes; at finish/fail/expiry for scoped runs,
  // during which `publishing` refuses every token) or the snapshot hash.
  "documents:upsert": "manifest",
  "documents:bulkSetContentHash": "manifest",
  "documents:deleteBySlug": "manifest",
  "documents:upsertPdfAsset": "manifest",
  "documents:backfillAssetHashes": "manifest",
  "documents:deletePdfAssetByPath": "manifest",
  "documents:upsertFileAsset": "manifest",
  "documents:deleteFileAssetByPath": "manifest",
  "sites:beginPublish": "manifest",
  "sites:finishPublish": "manifest",
  "sites:failPublish": "manifest",
  "sites:expirePublish": "manifest",
  "manifestCache:install": "manifest",
  // Cannot change a manifest.
  "users:resetPassword": { none: "password and sessions only; every request re-validates its session" },
  "users:createSession": { none: "sessions are validated live per request; the token names the user, not the session" },
  "users:deleteSession": { none: "sessions are validated live per request" },
  "cleanup:purgeExpiredSessions": { none: "expired sessions are already rejected live" },
  "cleanup:purgeExpiredOAuthStates": NO_MANIFEST_DATA,
  "sites:create": { none: "a new site has no tokens" },
  "sites:addPublishToken": { none: "publisher credentials only" },
  "sites:renewPublish": { none: "extends a lease that already refuses tokens" },
  "sites:cleanupPublishChanges": { none: "deletes a finished run's journal" },
  "manifestCache:requestBuild": { none: "queues a build; only install changes the snapshot" },
  "manifestCache:failed": { none: "releases a build lease" },
  "documents:upsertEmbedding": { none: "search vectors are not in manifests" },
  "documents:setMeta": { none: "site key/value metadata is not in manifests" },
  "pageShares:create": { none: "share links authorize one page by bearer token, outside manifests" },
  "pageShares:revoke": { none: "share links authorize one page by bearer token, outside manifests" },
  "prefetch:recordVisit": { none: "visit counts only order prefetching" },
  "palettePicks:record": { none: "palette picks only judge ranking" },
  "conversations:create": NO_MANIFEST_DATA,
  "conversations:beginRun": NO_MANIFEST_DATA,
  "conversations:updateStreaming": NO_MANIFEST_DATA,
  "conversations:clearStreaming": NO_MANIFEST_DATA,
  "conversations:cancelStream": NO_MANIFEST_DATA,
  "conversations:clearCancel": NO_MANIFEST_DATA,
  "conversations:archive": NO_MANIFEST_DATA,
  "conversations:restore": NO_MANIFEST_DATA,
  "conversations:remove": NO_MANIFEST_DATA,
  "conversations:saveMessages": NO_MANIFEST_DATA,
  "conversations:sendMessage": NO_MANIFEST_DATA,
  "conversations:disableMessage": NO_MANIFEST_DATA,
  "commentRooms:incrementRoom": NO_MANIFEST_DATA,
  "commentRooms:decrementRoom": NO_MANIFEST_DATA,
  "commentRooms:syncRooms": NO_MANIFEST_DATA,
  "imageAnnotations:saveForImage": NO_MANIFEST_DATA,
  "guestNames:upsert": NO_MANIFEST_DATA,
  "guestNames:remove": NO_MANIFEST_DATA,
  "migrations:nativePartsMessagesBatch": NO_MANIFEST_DATA,
  "migrations:nativePartsConversationsBatch": NO_MANIFEST_DATA,
  "epicFhir:createOAuthState": NO_MANIFEST_DATA,
  "epicFhir:consumeOAuthState": NO_MANIFEST_DATA,
  "epicFhir:upsertConnection": NO_MANIFEST_DATA,
  "epicFhir:markSyncStarted": NO_MANIFEST_DATA,
  "epicFhir:markSyncComplete": NO_MANIFEST_DATA,
  "epicFhir:markSyncError": NO_MANIFEST_DATA,
  "epicFhir:upsertLabResult": NO_MANIFEST_DATA,
  "dicom:upsertSeriesWithImages": NO_MANIFEST_DATA,
  "pathology:upsert": NO_MANIFEST_DATA,
  "pathology:saveRegions": NO_MANIFEST_DATA,
};

test("every exported mutation is classified for the manifest token", async () => {
  const found: string[] = [];
  for (const file of moduleFiles) {
    const module = await import(path.join(CONVEX_DIR, file)) as Record<string, { isMutation?: boolean }>;
    for (const [name, value] of Object.entries(module)) {
      if (value && (typeof value === "object" || typeof value === "function") && value.isMutation) found.push(`${file.replace(/\.ts$/, "")}:${name}`);
    }
  }
  expect(found.sort()).toEqual(Object.keys(MUTATIONS).sort());
});

const SITE = "diana";
const identity = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };

async function setup() {
  const t = convexTest(schema, modules).withIdentity(identity);
  const fx = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["{}"]));
    const siteId = await ctx.db.insert("sites", {
      slug: SITE, name: SITE, ownerEmail: "owner@example.test", status: "active", domains: ["localhost"], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: true, passwordHash: "sha256:one" },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
      manifestRevision: 1, manifestSnapshot: { revision: 1, formatVersion: MANIFEST_SNAPSHOT_VERSION, hash: "snapshot-1", storageId },
      // A held build lease: invalidations bump the revision without scheduling
      // a (node-only) build that would outlive the test.
      manifestBuildQueuedAt: Date.now(),
    });
    const user = (email: string) => ctx.db.insert("users", { siteId, email, passwordHash: "x", passwordSalt: "x", createdAt: 1, updatedAt: 1 });
    const reader = await user("reader@example.test");
    const other = await user("other@elsewhere.test");
    const care = await ctx.db.insert("roles", { siteId, name: "care", createdAt: 1, updatedAt: 1 });
    const byEmail = await ctx.db.insert("roles", { siteId, name: "by-email", emailPatterns: ["@example.test"], createdAt: 1, updatedAt: 1 });
    const spare = await ctx.db.insert("roles", { siteId, name: "spare", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId, roleId: care, includeTags: ["care"], createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId, roleId: byEmail, includePathPatterns: ["email/"], createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId, roleId: spare, includePathPatterns: ["path/"], createdAt: 1 });
    await ctx.db.insert("userRoles", { siteId, userId: reader, roleId: care, createdAt: 1 });
    const doc = (slug: string, sensitive: boolean, tags: string[] = []) => ctx.db.insert("documents", {
      siteId, slug, title: slug, content: "body", tags, sensitive, contentHash: slug, sizeBytes: 4, updatedAt: 1 });
    await doc("pub", false);
    await doc("care/a", true, ["care"]);
    await doc("email/b", true);
    await doc("path/c", true);
    const asset = (p: string, sensitive: boolean, ownerSlugs: string[]) => ctx.db.insert("pdfAssets", {
      siteId, path: p, blobUrl: `https://blob.invalid/${p}`, sizeBytes: 1, sensitive, ownerSlugs, uploadedAt: 1 });
    await asset("pub.pdf", false, []);
    await asset("care/a.pdf", true, ["care/a"]);
    await asset("path/c.pdf", true, ["path/c"]);
    return { siteId, reader, other, care, byEmail, spare, storageId };
  });
  const state = async () => (await t.query(api.manifestCache.knownState, { siteSlug: SITE }))!;
  // The session token (packages/wiki-content sessionKnownToken) is a hash of
  // the user and exactly these fence fields, and is refused while publishing.
  const token = async (userId: Id<"users">) => {
    const fence = await state();
    return fence.publishing || !fence.snapshotHash ? null
      : JSON.stringify([userId, fence.manifestRevision, fence.accessRevision, fence.policyVersion, fence.snapshotHash]);
  };
  // What a manifest built for this user would list beyond the public base.
  const readable = async (userId: Id<"users">) => {
    const pages: string[] = [], assets: string[] = [];
    let args: { pages?: string | null; assets?: string | null } = { pages: null, assets: null };
    for (let i = 0; i < 20; i++) {
      const result = await t.query(api.access.sessionManifestOverlay, { siteSlug: SITE, userId, numItems: 2, ...args });
      if (!result) return "unavailable";
      pages.push(...result.pages.map(page => `${page.slug}:${page.title}:${page.contentHash}`));
      assets.push(...result.assets);
      if (result.pagesDone && result.assetsDone) return JSON.stringify({ pages, assets });
      args = { ...(result.pagesDone ? {} : { pages: result.pagesCursor }), ...(result.assetsDone ? {} : { assets: result.assetsCursor }) };
    }
    throw new Error("overlay did not finish");
  };
  return { t, fx, state, token, readable };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const runId = "scoped:11111111-1111-1111-1111-111111111111";
const upsertDoc = (s: Setup, slug: string, extra: Record<string, unknown> = {}) => s.t.mutation(api.documents.upsert, {
  siteSlug: SITE, slug, title: `${slug} v2`, content: "body 2", contentHash: `${slug}-2`, tags: [], ...extra });

// One real change per classified mutation.
const SCENARIOS: Record<string, (s: Setup) => Promise<unknown>> = {
  "access:createRole": s => s.t.mutation(api.access.createRole, { siteSlug: SITE, name: "new", includePathPatterns: ["path/"], emailPatterns: ["@example.test"] }),
  "access:updateRole": s => s.t.mutation(api.access.updateRole, { siteSlug: SITE, roleId: s.fx.care, name: "care", includeTags: ["other"] }),
  "access:deleteRole": s => s.t.mutation(api.access.deleteRole, { siteSlug: SITE, roleId: s.fx.byEmail }),
  "access:assignRoleToUser": s => s.t.mutation(api.access.assignRoleToUser, { siteSlug: SITE, userId: s.fx.reader, roleId: s.fx.spare }),
  "access:setRoleForUser": s => s.t.mutation(api.access.setRoleForUser, { siteSlug: SITE, userId: s.fx.reader }),
  "access:setRoleForUsers": s => s.t.mutation(api.access.setRoleForUsers, { siteSlug: SITE, userIds: [s.fx.reader], roleId: s.fx.spare }),
  "access:deleteUsers": s => s.t.mutation(api.access.deleteUsers, { siteSlug: SITE, userIds: [s.fx.other] }),
  "users:create": s => s.t.mutation(api.users.create, { siteSlug: SITE, email: "new@example.test", passwordHash: "x", passwordSalt: "x" }),
  "sites:ensureDiana": s => s.t.mutation(internal.sites.ensureDiana, { passwordHash: "sha256:two" }),
  "sites:archive": s => s.t.mutation(internal.sites.archive, { slug: SITE }).then(() => s.t.mutation(internal.sites.restore, { slug: SITE })),
  "sites:restore": async s => {
    await s.t.run(ctx => ctx.db.patch(s.fx.siteId, { status: "archived" }));
    await s.t.mutation(internal.sites.restore, { slug: SITE });
  },
  "documentMeta:backfillBatch": async s => {
    for (let cursor: string | null = null, i = 0; i < 20; i++) {
      const result: { isDone: boolean; continueCursor: string | null } = await s.t.mutation(internal.documentMeta.backfillBatch, { siteSlug: SITE, cursor, numItems: 100 });
      if (result.isDone || !result.continueCursor) return;
      cursor = result.continueCursor;
    }
  },
  "documentMeta:setReady": s => s.t.mutation(internal.documentMeta.setReady, { siteSlug: SITE, ready: true }),
  "migrations:backfillSiteIdsBatch": async s => {
    await s.t.run(ctx => ctx.db.insert("users", { email: "legacy@example.test", passwordHash: "x", passwordSalt: "x", createdAt: 1, updatedAt: 1 }));
    await s.t.mutation(internal.migrations.backfillSiteIdsBatch, { table: "users" });
  },
  "documents:upsert": s => upsertDoc(s, "care/a", { tags: ["care"], sensitive: true }),
  "documents:bulkSetContentHash": s => s.t.mutation(api.documents.bulkSetContentHash, { siteSlug: SITE, entries: [{ slug: "care/a", contentHash: "changed" }] }),
  "documents:deleteBySlug": s => s.t.mutation(api.documents.deleteBySlug, { siteSlug: SITE, slug: "care/a" }),
  "documents:upsertPdfAsset": s => s.t.mutation(api.documents.upsertPdfAsset, { siteSlug: SITE, path: "care/a.pdf", blobUrl: "https://blob.invalid/x", sizeBytes: 1, sensitive: true, ownerSlugs: ["path/c"] }),
  "documents:backfillAssetHashes": s => s.t.mutation(api.documents.backfillAssetHashes, { siteSlug: SITE, entries: [
    { kind: "pdf", path: "care/a.pdf", contentHash: "h", ownerSlugs: ["path/c"], sensitive: true, sensitiveInclude: [], visibilityHash: "v" }] }),
  "documents:deletePdfAssetByPath": s => s.t.mutation(api.documents.deletePdfAssetByPath, { siteSlug: SITE, path: "care/a.pdf" }),
  "documents:upsertFileAsset": s => s.t.mutation(api.documents.upsertFileAsset, { siteSlug: SITE, path: "care/a.png", blobUrl: "https://blob.invalid/y", sizeBytes: 1, sensitive: true, ownerSlugs: ["care/a"] }),
  "documents:deleteFileAssetByPath": async s => {
    await s.t.run(ctx => ctx.db.insert("fileAssets", { siteId: s.fx.siteId, path: "f.png", blobUrl: "https://blob.invalid/f", sizeBytes: 1, uploadedAt: 1 }));
    await s.t.mutation(api.documents.deleteFileAssetByPath, { siteSlug: SITE, path: "f.png" });
  },
  "sites:beginPublish": s => s.t.mutation(api.sites.beginPublish, { slug: SITE, runId, scope: { documents: ["care/a"], assets: [] } }),
  "sites:finishPublish": async s => {
    await s.t.mutation(api.sites.beginPublish, { slug: SITE, runId, scope: { documents: ["care/a"], assets: [] } });
    await upsertDoc(s, "care/a", { runId, tags: ["care"], sensitive: true });
    await s.t.mutation(api.sites.finishPublish, { slug: SITE, runId });
  },
  "sites:failPublish": async s => {
    await s.t.mutation(api.sites.beginPublish, { slug: SITE, runId, scope: { documents: ["care/a"], assets: [] } });
    await upsertDoc(s, "care/a", { runId, tags: ["care"], sensitive: true });
    await s.t.mutation(api.sites.failPublish, { slug: SITE, runId, error: "fixture" });
  },
  "sites:expirePublish": async s => {
    await s.t.mutation(api.sites.beginPublish, { slug: SITE, runId, scope: { documents: ["care/a"], assets: [] } });
    await upsertDoc(s, "care/a", { runId, tags: ["care"], sensitive: true });
    await s.t.run(ctx => ctx.db.patch(s.fx.siteId, { publishLockUntil: Date.now() - 1 }));
    await s.t.mutation(internal.sites.expirePublish, { slug: SITE, runId });
    // Let the immediate journal cleanup it schedules run inside this test.
    await Bun.sleep(20);
    await s.t.finishInProgressScheduledFunctions();
  },
  "manifestCache:install": async s => {
    const storageId = await s.t.run(ctx => ctx.storage.store(new Blob(["{}"])));
    await s.t.run(ctx => ctx.db.patch(s.fx.siteId, { manifestBuildGeneration: 1 }));
    await s.t.mutation(internal.manifestCache.install, { siteSlug: SITE, revision: 1, hash: "snapshot-2", storageId, formatVersion: MANIFEST_SNAPSHOT_VERSION, generation: 1 });
  },
};

test("every access and manifest mutation changes the reader's token or refuses it", async () => {
  const classified = Object.entries(MUTATIONS).filter(([, effect]) => effect === "access" || effect === "manifest").map(([name]) => name);
  expect(Object.keys(SCENARIOS).sort()).toEqual(classified.sort());
  for (const name of classified) {
    const s = await setup();
    const before = await s.state();
    const token = await s.token(s.fx.reader);
    expect(token).not.toBeNull();
    await SCENARIOS[name]!(s);
    await s.t.finishInProgressScheduledFunctions();
    const after = await s.state();
    const next = await s.token(s.fx.reader);
    if (next === token) throw new Error(`${name} left the known token unchanged`);
    if (MUTATIONS[name] === "access") {
      // Same transaction, exactly the access fence.
      if (after.accessRevision <= before.accessRevision) throw new Error(`${name} did not bump accessRevision`);
    }
  }
});

test("no-op access writes keep the token when nothing readable changed", async () => {
  const s = await setup();
  const token = await s.token(s.fx.reader);
  // Re-assigning an existing role inserts nothing.
  await s.t.mutation(api.access.assignRoleToUser, { siteSlug: SITE, userId: s.fx.reader, roleId: s.fx.care });
  await s.t.mutation(api.access.setRoleForUsers, { siteSlug: SITE, userIds: [] });
  expect(await s.token(s.fx.reader)).toBe(token);
});

test("token unchanged implies readable set unchanged, over random mutation sequences", async () => {
  for (let seed = 1; seed <= 8; seed++) {
    const s = await setup();
    // mulberry32: every bit is usable, unlike a bare power-of-two LCG.
    let rng = seed;
    const next = () => {
      rng = (rng + 0x6d2b79f5) | 0;
      let x = Math.imul(rng ^ (rng >>> 15), 1 | rng);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
    };
    const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    const roles = [s.fx.care, s.fx.byEmail, s.fx.spare];
    const users = [s.fx.reader, s.fx.other];
    const slugs = ["care/a", "email/b", "path/c", "pub", "new/d"];
    const ops: Array<() => Promise<unknown>> = [
      () => s.t.mutation(api.access.setRoleForUser, { siteSlug: SITE, userId: pick(users), roleId: pick([...roles, undefined]) }),
      () => s.t.mutation(api.access.assignRoleToUser, { siteSlug: SITE, userId: pick(users), roleId: pick(roles) }),
      () => s.t.mutation(api.access.updateRole, { siteSlug: SITE, roleId: pick(roles), name: "r",
        includePathPatterns: [pick(["care/", "email/", "path/", "*", "nothing/"])], excludeTags: [pick(["care", "x"])], emailPatterns: [pick(["@example.test", "@elsewhere.test", "nobody@x.test"])] }),
      () => upsertDoc(s, pick(slugs), { sensitive: pick([true, false]), tags: [pick(["care", "x"])], contentHash: pick(["a", "b"]) }),
      () => s.t.mutation(api.documents.deleteBySlug, { siteSlug: SITE, slug: pick(slugs) }),
      () => s.t.mutation(api.documents.upsertPdfAsset, { siteSlug: SITE, path: pick(["care/a.pdf", "path/c.pdf", "new/d.pdf"]), blobUrl: "https://blob.invalid/z", sizeBytes: 1,
        sensitive: pick([true, false]), ownerSlugs: [pick(slugs)] }),
      // Unrelated writes: must not matter, and the invariant would catch it if they did.
      () => s.t.mutation(api.users.createSession, { siteSlug: SITE, userId: s.fx.reader, tokenHash: `t${next()}`, expiresAt: Date.now() + 1000 }),
      () => s.t.mutation(api.documents.setMeta, { siteSlug: SITE, key: "k", value: String(next()) }),
      () => s.t.mutation(internal.users.resetPassword, { siteSlug: SITE, email: "reader@example.test", passwordHash: "y", passwordSalt: "y" }),
    ];
    let previous = { token: await s.token(s.fx.reader), readable: await s.readable(s.fx.reader) };
    for (let step = 0; step < 30; step++) {
      await pick(ops)().catch(() => undefined); // e.g. deleting a missing row
      const now = { token: await s.token(s.fx.reader), readable: await s.readable(s.fx.reader) };
      if (now.token !== null && now.token === previous.token && now.readable !== previous.readable) {
        throw new Error(`seed ${seed} step ${step}: readable set changed under an unchanged token`);
      }
      previous = now;
    }
  }
});

test("a publisher in progress refuses every token, even an expired lease before its expiry job", async () => {
  const s = await setup();
  await s.t.mutation(api.sites.beginPublish, { slug: SITE, runId, scope: { documents: ["care/a"], assets: [] } });
  expect(await s.token(s.fx.reader)).toBeNull();
  await s.t.run(ctx => ctx.db.patch(s.fx.siteId, { publishLockUntil: Date.now() - 1 }));
  expect((await s.state()).publishing).toBe(true);
  expect(await s.token(s.fx.reader)).toBeNull();
});

test("the one-transaction overlay equals the old query chain", async () => {
  const s = await setup();
  await s.t.mutation(api.access.assignRoleToUser, { siteSlug: SITE, userId: s.fx.reader, roleId: s.fx.spare });
  await s.t.run(async ctx => {
    // Incomplete visibility counts as sensitive; a sibling document is an owner.
    await ctx.db.insert("pdfAssets", { siteId: s.fx.siteId, path: "path/c-extra.pdf", blobUrl: "https://blob.invalid/e", sizeBytes: 1, uploadedAt: 1 });
    await ctx.db.insert("pdfAssets", { siteId: s.fx.siteId, path: "email/b.pdf", blobUrl: "https://blob.invalid/b", sizeBytes: 1, sensitive: true, ownerSlugs: [], uploadedAt: 1 });
  });
  for (const userId of [s.fx.reader, s.fx.other]) {
    const pages = await s.t.query(api.access.listAllowedSensitiveManifestPage, { siteSlug: SITE, userId, cursor: null, numItems: 500 });
    const visibility = await s.t.query(api.documents.listPdfAssetVisibilityPage, { siteSlug: SITE, cursor: null, numItems: 1000, includeSensitive: true });
    const owners = [...new Set(visibility.page.filter(asset => asset.sensitive).flatMap(asset => asset.ownerSlugs))];
    const access = new Map((await s.t.query(api.access.filterAccessibleSlugs, { siteSlug: SITE, userId, slugs: owners })).map(row => [row.slug, row]));
    const oldAssets = visibility.page.filter(asset => !asset.sensitive ||
      (asset.ownerSlugs.length > 0 && asset.ownerSlugs.every(slug => access.get(slug)?.hasDocument && access.get(slug)?.allowed))).map(asset => asset.path);
    const overlay = await s.t.query(api.access.sessionManifestOverlay, { siteSlug: SITE, userId, numItems: 500, pages: null, assets: null });
    expect(overlay!.pages).toEqual(pages.page);
    expect(overlay!.assets).toEqual(oldAssets);
    expect(overlay!.fence).toEqual(await s.state());
    expect(JSON.stringify(overlay)).not.toContain("blob.invalid");
  }
});

test("overlay asset pages are exact across duplicate paths and page boundaries", async () => {
  const s = await setup();
  await s.t.run(async ctx => {
    for (let i = 0; i < 1003; i++) {
      await ctx.db.insert("pdfAssets", { siteId: s.fx.siteId, path: `bulk/${String(i % 600).padStart(4, "0")}.pdf`, blobUrl: "https://blob.invalid/b", sizeBytes: 1, sensitive: false, ownerSlugs: [], uploadedAt: 1 });
    }
  });
  // eslint-disable-next-line no-restricted-syntax -- Test oracle reads the fixture site's rows by its id.
  const all = await s.t.run(ctx => ctx.db.query("pdfAssets").withIndex("by_site_path", q => q.eq("siteId", s.fx.siteId)).collect());
  const expected = all.filter(row => !row.sensitive).map(row => row.path);
  const seen: string[] = [];
  let assets: string | null = null;
  for (let i = 0; i < 10; i++) {
    const result: { assets: string[]; assetsDone: boolean; assetsCursor: string | null } | null =
      await s.t.query(api.access.sessionManifestOverlay, { siteSlug: SITE, userId: s.fx.other, numItems: 10, assets });
    seen.push(...result!.assets);
    if (result!.assetsDone) break;
    assets = result!.assetsCursor;
  }
  expect(seen).toEqual(expected);
});

test("overlay calls report the rows they read by outcome, counts only", async () => {
  const s = await setup();
  await s.t.run(async ctx => {
    const file = (path: string, fields: { sensitive?: boolean; ownerSlugs?: string[]; deletedAt?: number }) =>
      ctx.db.insert("fileAssets", { siteId: s.fx.siteId, path, blobUrl: `https://blob.invalid/${path}`, sizeBytes: 1, uploadedAt: 1, ...fields });
    await file("pub.png", { sensitive: false, ownerSlugs: [] });
    await file("care/a.png", { sensitive: true, ownerSlugs: ["care/a"] });
    await file("care/gone.png", { sensitive: true, ownerSlugs: ["care/a"], deletedAt: 5 });
    await file("path/c.png", { sensitive: true, ownerSlugs: ["path/c"] });
    await ctx.db.insert("pdfAssets", { siteId: s.fx.siteId, path: "care/live.pdf", blobUrl: "https://blob.invalid/l", sizeBytes: 1, sensitive: false, ownerSlugs: [], uploadedAt: 1 });
    await ctx.db.insert("pdfAssets", { siteId: s.fx.siteId, path: "care/old.pdf", blobUrl: "https://blob.invalid/o", sizeBytes: 1, sensitive: false, ownerSlugs: [], uploadedAt: 1, deletedAt: 5 });
  });
  const result = (await s.t.query(api.access.sessionManifestOverlay, { siteSlug: SITE, userId: s.fx.reader, numItems: 10, files: null, assets: null }))!;
  expect(result.assets).toContain("care/live.pdf");
  expect(result.assets).not.toContain("care/old.pdf");
  // The tombstone is skipped by the index, not read and dropped.
  expect(result.scan.assets.deleted).toBe(0);
  expect(result.scan.assets.read).toBe(result.assets.length + result.scan.assets.denied);
  // Public rows and tombstones are never read: the index starts at live
  // sensitive rows.
  const { lookups, ...files } = result.scan.files;
  expect(files).toEqual({ read: 2, deleted: 0, denied: 1, kept: 1 });
  // care/a and path/c, each read once although PDFs and files both name them.
  expect(lookups + result.scan.assets.lookups).toBe(2);
  expect(result.files).toEqual(["care/a.png"]);
});

test("overlay files list only the user's readable sensitive files, with stored hashes, across groups and pages", async () => {
  const s = await setup();
  await s.t.run(async ctx => {
    const file = (path: string, fields: { sensitive?: boolean; ownerSlugs?: string[]; contentHash?: string }) =>
      ctx.db.insert("fileAssets", { siteId: s.fx.siteId, path, blobUrl: `https://blob.invalid/${path}`, sizeBytes: 1, uploadedAt: 1, ...fields });
    await file("pub.png", { sensitive: false, ownerSlugs: [], contentHash: "pub-1" });
    await file("care/a.png", { sensitive: true, ownerSlugs: ["care/a"], contentHash: "care-1" });
    await file("path/c.png", { sensitive: true, ownerSlugs: ["path/c"], contentHash: "path-1" });
    // Legacy rows without the flag count as sensitive; a sibling is an owner.
    await file("care/a/legacy.png", { ownerSlugs: ["care/a"] });
    await file("pub/orphan.png", { sensitive: true, ownerSlugs: [] });
    // More than one page of sensitive rows, so the cursor crosses pages and groups.
    for (let i = 0; i < 510; i++) await file(`care/bulk/${String(i).padStart(4, "0")}.png`, { sensitive: true, ownerSlugs: ["care/a"], contentHash: `bulk-${i}` });
  });
  const list = async (userId: Id<"users">) => {
    const paths: string[] = [], hashes: Array<string | null> = [];
    let files: string | null = null;
    for (let i = 0; i < 10; i++) {
      const result = (await s.t.query(api.access.sessionManifestOverlay, { siteSlug: SITE, userId, numItems: 10, files }))!;
      paths.push(...result.files!); hashes.push(...result.fileHashes!);
      if (result.filesDone) return { paths, hashes, pages: i + 1 };
      files = result.filesCursor!;
    }
    throw new Error("files did not finish");
  };
  const reader = await list(s.fx.reader);
  const bulk = Array.from({ length: 510 }, (_, i) => `care/bulk/${String(i).padStart(4, "0")}.png`);
  expect(reader.paths).toEqual(["care/a.png", ...bulk, "care/a/legacy.png"]);
  expect(reader.hashes).toEqual(["care-1", ...bulk.map((_, i) => `bulk-${i}`), null]);
  expect(reader.pages).toBeGreaterThan(1);
  // Public files come from the public snapshot, never the overlay.
  expect(reader.paths).not.toContain("pub.png");
  expect((await list(s.fx.other)).paths).toEqual([]);
  // A backend call that does not ask for files answers exactly as before.
  const legacy = (await s.t.query(api.access.sessionManifestOverlay, { siteSlug: SITE, userId: s.fx.reader, numItems: 10, assets: null }))!;
  expect("files" in legacy).toBe(false);
  expect(legacy.assets.length).toBe(legacy.assetHashes.length);
  // The manifest builder's public listing carries the same stored hashes.
  const visibility = await s.t.query(api.documents.listFileAssetVisibilityPage, { siteSlug: SITE, cursor: null, numItems: 1000 });
  expect(visibility.isDone).toBe(true);
  expect(visibility.page).toEqual([{ path: "pub.png", ownerSlugs: [], sensitive: false, contentHash: "pub-1" }]);
});

test("overlay asset checks read each document once and match the per-slug oracle", async () => {
  const s = await setup();
  await s.t.run(async ctx => {
    const siteId = s.fx.siteId;
    const doc = (slug: string, sensitive: boolean, tags: string[] = []) => ctx.db.insert("documents", {
      siteId, slug, title: slug, content: "body", tags, sensitive, contentHash: slug, sizeBytes: 4, updatedAt: 1 });
    const pdf = (p: string, fields: { sensitive?: boolean; ownerSlugs?: string[] }) => ctx.db.insert("pdfAssets", {
      siteId, path: p, blobUrl: `https://blob.invalid/${p}`, sizeBytes: 1, uploadedAt: 1, ...fields });
    const file = (p: string, fields: { sensitive?: boolean; ownerSlugs?: string[] }) => ctx.db.insert("fileAssets", {
      siteId, path: p, blobUrl: `https://blob.invalid/${p}`, sizeBytes: 1, uploadedAt: 1, ...fields });
    for (let i = 0; i < 60; i++) {
      const n = String(i).padStart(3, "0");
      // Readable to the reader (care tag), unreadable (path/), and public.
      await doc(`care/d${n}`, true, ["care"]);
      await doc(`path/d${n}`, true);
      await doc(`pub/d${n}`, false);
      // PDFs whose sibling is also their owner, whose sibling is another
      // readable or unreadable document, whose sibling does not exist, and
      // rows without complete visibility metadata.
      await pdf(`care/d${n}.pdf`, { sensitive: true, ownerSlugs: [`care/d${n}`] });
      await pdf(`pub/d${n}.pdf`, { sensitive: true, ownerSlugs: [`care/d${n}`] });
      await pdf(`path/d${n}.pdf`, { sensitive: true, ownerSlugs: [`care/d${n}`] });
      await pdf(`care/d${n}/scan.pdf`, { sensitive: true, ownerSlugs: [`care/d${n}`, `pub/d${n}`] });
      await pdf(`legacy/d${n}.pdf`, {});
      await pdf(`care/d${n}x.pdf`, { ownerSlugs: [] });
      await pdf(`pub/d${n}-public.pdf`, { sensitive: false, ownerSlugs: [] });
      // Sensitive files share a handful of owners; some name a missing one.
      for (let j = 0; j < 4; j++) await file(`care/d${n}/fig${j}.png`, { sensitive: true, ownerSlugs: [`care/d${String(i % 5).padStart(3, "0")}`] });
      await file(`path/d${n}.png`, { sensitive: true, ownerSlugs: [`path/d${n}`] });
      await file(`gone/d${n}.png`, { sensitive: true, ownerSlugs: [`gone/d${n}`] });
      await file(`legacy/d${n}.png`, { ownerSlugs: [`care/d${n}`] });
    }
  });
  const rows = await s.t.run(async ctx => ({
    // eslint-disable-next-line no-restricted-syntax -- Test oracle reads the fixture site's rows by its id.
    pdfs: await ctx.db.query("pdfAssets").withIndex("by_site_path", q => q.eq("siteId", s.fx.siteId)).collect(),
    // eslint-disable-next-line no-restricted-syntax -- Test oracle reads the fixture site's rows by its id.
    files: await ctx.db.query("fileAssets").withIndex("by_site_path", q => q.eq("siteId", s.fx.siteId)).collect(),
  }));
  const sibling = (p: string) => p.replace(/\.[^/.]+$/, "");
  const complete = (row: { sensitive?: boolean; ownerSlugs?: string[] }) => typeof row.sensitive === "boolean" && Array.isArray(row.ownerSlugs);
  const byIndex = (a: { path: string; _creationTime: number }, b: { path: string; _creationTime: number }) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a._creationTime - b._creationTime;
  const checked = [...rows.pdfs.filter(row => !complete(row) || row.sensitive), ...rows.files.filter(row => row.sensitive !== false)];
  const distinct = new Set(checked.flatMap(row => [...(row.ownerSlugs ?? []), sibling(row.path)]));
  for (const userId of [s.fx.reader, s.fx.other]) {
    // Oracle: the owners plus an existing sibling, each present and readable.
    const access = new Map((await s.t.query(api.access.filterAccessibleSlugs, { siteSlug: SITE, userId, slugs: [...distinct] })).map(row => [row.slug, row]));
    const visible = (row: { path: string; ownerSlugs?: string[] }) => {
      const owners = new Set(row.ownerSlugs ?? []);
      if (access.get(sibling(row.path))?.hasDocument) owners.add(sibling(row.path));
      return owners.size > 0 && [...owners].every(slug => access.get(slug)?.hasDocument && access.get(slug)?.allowed);
    };
    const expectedAssets = rows.pdfs.slice().sort(byIndex).filter(row => (complete(row) && !row.sensitive) || visible(row)).map(row => row.path);
    const sensitiveFiles = (group: boolean | undefined) => rows.files.filter(row => row.sensitive === group).sort(byIndex);
    const expectedFiles = [...sensitiveFiles(true), ...sensitiveFiles(undefined)].filter(visible).map(row => row.path);
    const result = (await s.t.query(api.access.sessionManifestOverlay, { siteSlug: SITE, userId, numItems: 500, assets: null, files: null }))!;
    expect(result.assetsDone && result.filesDone).toBe(true);
    expect(result.assets).toEqual(expectedAssets);
    expect(result.files).toEqual(expectedFiles);
    expect(result.assets.length).toBeGreaterThan(60);
    // Each distinct owner or sibling slug is read once per call, however many
    // rows name it; public PDFs with complete metadata need no lookup.
    // (Awaiting each row's sibling and re-reading it as an owner took 1024
    // sequential lookups for this fixture; 662 distinct slugs remain.)
    expect(result.scan.assets.lookups + result.scan.files.lookups).toBe(distinct.size);
    expect(result.scan.pages).not.toHaveProperty("lookups");
  }
});

test("the access policy code is fingerprinted with ACCESS_POLICY_VERSION", () => {
  // If this fails you changed who-can-read-what code. Decide whether existing
  // tokens may survive the deploy; if not (the safe default), bump
  // ACCESS_POLICY_VERSION in lib/accessRevision.ts. Then update the fingerprint.
  const source = (file: string) => readFileSync(path.join(CONVEX_DIR, file), "utf8");
  const access = source("access.ts");
  const fn = (name: string) => {
    const start = access.search(new RegExp(`(^|\\n)(export )?(async )?function ${name}\\b|(^|\\n)(export )?const ${name}\\b`));
    if (start < 0) throw new Error(`missing ${name}`);
    const end = access.indexOf("\n}\n", start);
    return access.slice(start, end);
  };
  const policy = [
    ...["pathAllowed", "cleanList", "cleanTags", "LEGACY_SENSITIVE_INCLUDE_TAGS", "documentTagMatchesRuleTag", "cleanEmailPatterns",
      "emailMatchesPattern", "EMAIL_PATTERN_GRANTS_BEFORE", "roleMatchesEmail", "ruleMatchesSlug", "createDocumentAccessCheck",
      "allowedManifestRows", "canUserAccessSlug", "sessionManifestOverlay"].map(fn),
    source("lib/accessPolicy.ts"), source("lib/assetVisibility.ts"),
  ].join("\n--\n");
  const fingerprint = createHash("sha256").update(policy).digest("hex").slice(0, 16);
  expect({ version: ACCESS_POLICY_VERSION, fingerprint }).toEqual({ version: 2, fingerprint: "f2dc42c9a2fd73cb" });
});
