/* eslint-disable no-restricted-syntax -- fixture inspection of raw tables inside t.run, not a tenant read path. */
import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { drainScheduled } from "./drain-scheduled.testutil";

const modules = {
  "../documents.ts": () => import("../documents"),
  "../_generated/server.js": () => import("../_generated/server"),
};
const service = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };

const siteRow = (slug: string) => ({
  slug, name: slug, ownerEmail: "owner@example.test", status: "active" as const, domains: [], publishTokenHash: "fixture",
  config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
  quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
});

async function setup() {
  const anonymous = convexTest(schema, modules);
  const t = anonymous.withIdentity(service);
  await t.run(async ctx => { await ctx.db.insert("sites", siteRow("alpha")); await ctx.db.insert("sites", siteRow("beta")); });
  return { t, anonymous };
}

const publish = (t: Awaited<ReturnType<typeof setup>>["t"], slug: string, title: string, content: string, extra: { sensitive?: boolean; tags?: string[]; sensitiveInclude?: string[]; siteSlug?: string } = {}) =>
  t.mutation(api.documents.upsert, { siteSlug: extra.siteSlug ?? "alpha", slug, title, content, tags: extra.tags ?? [], contentHash: `${title}:${content}`, sensitive: extra.sensitive, sensitiveInclude: extra.sensitiveInclude });

test("each publish that changes the body archives the outgoing version", async () => {
  const { t } = await setup();
  await publish(t, "page", "Page", "one");
  await publish(t, "page", "Page", "one", { tags: ["metadata-only"] });
  await publish(t, "page", "Page", "two");
  await publish(t, "page", "Renamed", "two");
  const history = await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" });
  expect(history?.current.title).toBe("Renamed");
  expect(history?.versions.map(v => v.title)).toEqual(["Page", "Page"]);
  const [newest, oldest] = history!.versions;
  expect((await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: oldest.id }))?.content).toBe("one");
  expect((await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: newest.id }))?.content).toBe("two");
  // Same publish replayed: no duplicate version.
  await publish(t, "page", "Renamed", "two");
  expect((await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" }))?.versions).toHaveLength(2);
  await drainScheduled(t);
});

test("versions never leak across pages, tenants or into the public scope", async () => {
  const { t, anonymous } = await setup();
  await publish(t, "page", "Page", "SECRET_OLD", { sensitive: true });
  await publish(t, "page", "Page", "now public", { sensitive: false });
  await publish(t, "page", "Page", "public edit", { sensitive: false });
  await publish(t, "other", "Other", "a");
  await publish(t, "other", "Other", "b");
  await publish(t, "page", "Page", "beta", { siteSlug: "beta" });
  await publish(t, "page", "Page", "beta 2", { siteSlug: "beta" });

  // The page is public now: its private past is hidden.
  const history = await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" });
  expect(history?.versions.map(v => v.title)).toEqual(["Page"]);
  const all = await t.run(ctx => ctx.db.query("documentVersions").collect());
  const secret = all.find(v => v.slug === "page" && v.sensitive)!;
  expect(await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: secret._id })).toBeNull();

  const otherVersion = all.find(v => v.slug === "other")!;
  const betaVersion = all.find(v => v.slug === "page" && v.siteId !== secret.siteId)!;
  expect(await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: otherVersion._id })).toBeNull();
  expect(await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: betaVersion._id })).toBeNull();
  expect(await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: "not-an-id" })).toBeNull();

  // A restricted live page needs an authorized session.
  await publish(t, "page", "Page", "private again", { sensitive: true });
  expect(await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" })).toBeNull();

  await expect(anonymous.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" })).rejects.toThrow();
  await expect(anonymous.mutation(api.documents.importVersions, { siteSlug: "alpha", slug: "page", versions: [] })).rejects.toThrow();
  await drainScheduled(t);
});

test("restricted history requires access under both live and historical tags", async () => {
  const { t } = await setup();
  const { reader, reviewer } = await t.run(async ctx => {
    const siteId = (await ctx.db.query("sites").withIndex("by_slug", q => q.eq("slug", "alpha")).unique())!._id;
    const everyone = await ctx.db.insert("roles", { siteId, name: "reader", createdAt: 1, updatedAt: 1 });
    const reviewers = await ctx.db.insert("roles", { siteId, name: "reviewer", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId, roleId: everyone, excludeTags: ["serova-sensitive"], createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId, roleId: reviewers, includeTags: ["serova-sensitive"], createdAt: 1 });
    const reader = await ctx.db.insert("users", { siteId, email: "reader@example.test", passwordHash: "fixture", passwordSalt: "fixture", createdAt: 1, updatedAt: 1 });
    const reviewer = await ctx.db.insert("users", { siteId, email: "reviewer@example.test", passwordHash: "fixture", passwordSalt: "fixture", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("userRoles", { siteId, userId: reader, roleId: everyone, createdAt: 1 });
    await ctx.db.insert("userRoles", { siteId, userId: reviewer, roleId: everyone, createdAt: 1 });
    await ctx.db.insert("userRoles", { siteId, userId: reviewer, roleId: reviewers, createdAt: 1 });
    return { reader, reviewer };
  });
  await publish(t, "page", "Page", "restricted outgoing text", { sensitive: true, sensitiveInclude: ["serova"] });
  await publish(t, "page", "Page", "broadly readable text", { sensitive: true });
  await t.mutation(api.documents.importVersions, {
    siteSlug: "alpha", slug: "page",
    versions: [{ title: "Page", content: "restricted git text", tags: [], sensitive: true, sensitiveInclude: ["serova"], versionAt: 1 }],
  });
  const page = { siteSlug: "alpha", slug: "page" };
  expect((await t.query(api.documents.listVersions, { ...page, userId: reader }))?.versions).toEqual([]);
  const history = await t.query(api.documents.listVersions, { ...page, userId: reviewer });
  expect(history?.versions).toHaveLength(2);
  for (const { id } of history!.versions) {
    expect(await t.query(api.documents.getVersion, { ...page, userId: reader, versionId: id })).toBeNull();
    expect(await t.query(api.documents.getVersion, { ...page, userId: reviewer, versionId: id })).not.toBeNull();
  }
  await drainScheduled(t);
});

test("git import dedupes against the live page and stored versions", async () => {
  const { t } = await setup();
  await publish(t, "page", "Page", "v1");
  await publish(t, "page", "Page", "v3");
  const versions = [
    { title: "Page", content: "v0", tags: [], sensitive: false, versionAt: 10, commitSha: "a".repeat(40), commitMessage: "first" },
    { title: "Page", content: "v0", tags: ["frontmatter-only"], sensitive: false, versionAt: 15, commitSha: "b".repeat(40) },
    { title: "Page", content: "v1", tags: [], sensitive: false, versionAt: 20 },
    { title: "Page", content: "v2", tags: [], sensitive: false, versionAt: 30, commitMessage: "second" },
    { title: "Page", content: "v3", tags: [], sensitive: false, versionAt: 40 },
    { title: "Page", content: "é".repeat(530_000), tags: [], sensitive: false, versionAt: 50 },
  ];
  expect(await t.mutation(api.documents.importVersions, { siteSlug: "alpha", slug: "page", versions })).toEqual({ found: true, inserted: 2, skipped: 3, oversized: 1 });
  expect(await t.mutation(api.documents.importVersions, { siteSlug: "alpha", slug: "page", versions })).toEqual({ found: true, inserted: 0, skipped: 5, oversized: 1 });
  expect(await t.mutation(api.documents.importVersions, { siteSlug: "alpha", slug: "missing", versions })).toMatchObject({ found: false });
  const history = await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" });
  // v1 came from the publish archive (stamped with its publish time); the git copy of it was skipped.
  expect(history?.versions.map(v => [v.source, v.commitMessage ?? null])).toEqual([["publish", null], ["git", "second"], ["git", "first"]]);
  await drainScheduled(t);
});
