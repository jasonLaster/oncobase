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

const publish = (t: Awaited<ReturnType<typeof setup>>["t"], slug: string, title: string, content: string, extra: { sensitive?: boolean; tags?: string[]; siteSlug?: string } = {}) =>
  t.mutation(api.documents.upsert, { siteSlug: extra.siteSlug ?? "alpha", slug, title, content, tags: extra.tags ?? [], contentHash: `${title}:${content}`, sensitive: extra.sensitive });

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

  // The page is public now: its private past is hidden, even with includeSensitive.
  const history = await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page", includeSensitive: true });
  expect(history?.versions.map(v => v.title)).toEqual(["Page"]);
  const all = await t.run(ctx => ctx.db.query("documentVersions").collect());
  const secret = all.find(v => v.slug === "page" && v.sensitive)!;
  expect(await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: secret._id, includeSensitive: true })).toBeNull();

  const otherVersion = all.find(v => v.slug === "other")!;
  const betaVersion = all.find(v => v.slug === "page" && v.siteId !== secret.siteId)!;
  expect(await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: otherVersion._id })).toBeNull();
  expect(await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: betaVersion._id })).toBeNull();
  expect(await t.query(api.documents.getVersion, { siteSlug: "alpha", slug: "page", versionId: "not-an-id" })).toBeNull();

  // A restricted live page needs includeSensitive and then shows its whole history.
  await publish(t, "page", "Page", "private again", { sensitive: true });
  expect(await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" })).toBeNull();
  expect((await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page", includeSensitive: true }))?.versions).toHaveLength(3);

  await expect(anonymous.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" })).rejects.toThrow();
  await expect(anonymous.mutation(api.documents.importVersions, { siteSlug: "alpha", slug: "page", versions: [] })).rejects.toThrow();
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
  ];
  expect(await t.mutation(api.documents.importVersions, { siteSlug: "alpha", slug: "page", versions })).toEqual({ found: true, inserted: 2, skipped: 3 });
  expect(await t.mutation(api.documents.importVersions, { siteSlug: "alpha", slug: "page", versions })).toEqual({ found: true, inserted: 0, skipped: 5 });
  expect(await t.mutation(api.documents.importVersions, { siteSlug: "alpha", slug: "missing", versions })).toMatchObject({ found: false });
  const history = await t.query(api.documents.listVersions, { siteSlug: "alpha", slug: "page" });
  // v1 came from the publish archive (stamped with its publish time); the git copy of it was skipped.
  expect(history?.versions.map(v => [v.source, v.commitMessage ?? null])).toEqual([["publish", null], ["git", "second"], ["git", "first"]]);
  await drainScheduled(t);
});
