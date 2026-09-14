import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

const modules = {
  "../documents.ts": () => import("../documents"),
  "../_generated/server.js": () => import("../_generated/server"),
};

test("sensitive metadata pagination skips public rows and preserves visibility and tenant boundaries", async () => {
  const unauthed = convexTest(schema, modules);
  const t = unauthed.withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  await t.run(async ctx => {
    const site = (slug: string) => ctx.db.insert("sites", {
      slug, name: slug, ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
    });
    const a = await site("alpha"), b = await site("beta");
    const doc = { title: "fixture", content: "BODY_NOT_METADATA", tags: [], updatedAt: 1 };
    for (let i = 0; i < 100; i++) await ctx.db.insert("documents", { ...doc, siteId: a, slug: `a-public-${i}`, sensitive: false });
    for (let i = 0; i < 3; i++) await ctx.db.insert("documents", { ...doc, siteId: a, slug: `z-private-${i}`, sensitive: true });
    await ctx.db.insert("documents", { ...doc, siteId: a, slug: "z-deleted", sensitive: true, deletedAt: 1 });
    await ctx.db.insert("documents", { ...doc, siteId: b, slug: "z-other", sensitive: true });
    await ctx.db.insert("documents", { ...doc, slug: "z-unscoped", sensitive: true });
  });
  const args = { siteSlug: "alpha", cursor: null, numItems: 2, includeSensitive: true, sensitiveOnly: true };
  await expect(unauthed.query(api.documents.listPage, args)).rejects.toThrow("Unauthorized");
  const slugs: string[] = [];
  let cursor: string | null = null;
  let calls = 0;
  for (;;) {
    const page = await t.query(api.documents.listPage, { ...args, cursor });
    expect(JSON.stringify(page)).not.toContain("BODY_NOT_METADATA");
    slugs.push(...page.page.map(doc => doc.slug));
    if (++calls > 3) throw new Error("Sensitive pagination scanned public rows");
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  // Four indexed rows (including the tombstone), then the terminal empty page.
  expect(calls).toBe(3);
  expect(slugs).toEqual(["z-private-0", "z-private-1", "z-private-2"]);
  const all = await t.query(api.documents.listPage, { ...args, numItems: 200, sensitiveOnly: false });
  expect(all.page.filter(doc => doc.sensitive === true).map(doc => doc.slug)).toEqual(slugs);
  expect((await t.query(api.documents.listPage, { ...args, numItems: 200, includeSensitive: false })).page).toEqual([]);
  expect((await t.query(api.documents.listPage, { ...args, siteSlug: "missing" })).page).toEqual([]);
});

test("public manifest index includes unset/false sensitivity, excludes other tenants and restricted rows before pagination", async () => {
  const t = convexTest(schema, modules).withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  await t.run(async (ctx) => {
    const site = (slug: string) => ctx.db.insert("sites", {
      slug, name: slug, ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
    });
    const a = await site("alpha");
    const b = await site("beta");
    const doc = { title: "fixture", content: "body", tags: [], updatedAt: 1 };
    for (let i = 0; i < 100; i++) await ctx.db.insert("documents", { ...doc, siteId: a, slug: `a-private-${i}`, sensitive: true });
    await ctx.db.insert("documents", { ...doc, siteId: a, slug: "z-unset" });
    await ctx.db.insert("documents", { ...doc, siteId: a, slug: "z-false", sensitive: false });
    await ctx.db.insert("documents", { ...doc, siteId: a, slug: "z-deleted", sensitive: false, deletedAt: 1 });
    await ctx.db.insert("documents", { ...doc, siteId: b, slug: "z-other", sensitive: false });
    await ctx.db.insert("documents", { ...doc, slug: "z-unscoped" });
  });
  const read = (cursor: string | null, includeSensitive = false) => t.query(api.documents.listManifestPage, { siteSlug: "alpha", cursor, numItems: 2, includeSensitive });
  const slugs: string[] = [];
  let cursor: string | null = null;
  let calls = 0;
  for (;;) {
    const page = await read(cursor);
    slugs.push(...page.page.map((doc) => doc.slug));
    calls++;
    if (page.isDone) break;
    cursor = page.continueCursor;
    if (calls > 3) throw new Error("Public pagination scanned restricted rows");
  }
  expect(slugs.sort()).toEqual(["z-false", "z-unset"]);
  expect(calls).toBe(2);
  const session = await read(null, true);
  expect(session.page).toHaveLength(2);
  expect(session.page.every((doc) => doc.sensitive)).toBe(true);
  expect((await t.query(api.documents.listManifestPage, { siteSlug: "missing", cursor: null, numItems: 500 })).page).toEqual([]);
});
