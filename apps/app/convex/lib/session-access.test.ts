import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import type { Id } from "../_generated/dataModel";

const modules = {
  "../access.ts": () => import("../access"),
  "../documents.ts": () => import("../documents"),
  "../_generated/server.js": () => import("../_generated/server"),
};

test("combined sensitive pagination preserves batch grants, exclusions, revocation and tenant boundaries", async () => {
  const unauthed = convexTest(schema, modules);
  const t = unauthed.withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  const fixture = await t.run(async ctx => {
    const site = (slug: string) => ctx.db.insert("sites", {
      slug, name: slug, ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
    });
    const a = await site("alpha"), b = await site("beta");
    const user = await ctx.db.insert("users", { siteId: a, email: "reader@example.test", name: "Reader", passwordHash: "fixture", passwordSalt: "fixture", createdAt: 1, updatedAt: 1 });
    const foreign = await ctx.db.insert("users", { siteId: b, email: "reader@example.test", passwordHash: "fixture", passwordSalt: "fixture", createdAt: 1, updatedAt: 1 });
    const paths = await ctx.db.insert("roles", { siteId: a, name: "Paths", createdAt: 1, updatedAt: 1 });
    const tags = await ctx.db.insert("roles", { siteId: a, name: "Email tags", emailPatterns: ["@example.test"], createdAt: 1, updatedAt: 1 });
    const denied = await ctx.db.insert("roles", { siteId: a, name: "Unassigned", createdAt: 1, updatedAt: 1 });
    const foreignRole = await ctx.db.insert("roles", { siteId: b, name: "Other tenant", emailPatterns: ["*"], createdAt: 1, updatedAt: 1 });
    const assignment = await ctx.db.insert("userRoles", { siteId: a, userId: user, roleId: paths, createdAt: 1 });
    await ctx.db.insert("userRoles", { siteId: b, userId: user, roleId: denied, createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: a, roleId: paths, pathPattern: "private/path/", excludePathPatterns: ["private/path/no"], createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: a, roleId: tags, includeTags: [" ECHO-SENSITIVE ", "echo"], excludeTags: ["blocked", "serova"], createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: a, roleId: denied, includePathPatterns: ["private/denied"], createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: a, roleId: foreignRole, pathPattern: "*", createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: b, roleId: tags, pathPattern: "*", createdAt: 1 });
    const doc = { title: "fixture", content: "BODY_NOT_RETURNED", tags: [] as string[], updatedAt: 1 };
    for (let i = 0; i < 40; i++) await ctx.db.insert("documents", { ...doc, siteId: a, slug: `a-public-${i}`, sensitive: false });
    for (const [slug, docTags, sensitiveInclude] of [
      ["private/path/ok", [], []], ["private/path/no", [], []],
      ["private/tag/legacy", ["Echo-Sensitive"], []], ["private/tag/include", [], [" ECHO "]],
      ["private/tag/direct", ["echo"], []], ["private/tag/blocked", ["echo", "blocked"], []],
      ["private/tag/alias-excluded", ["echo", "serova-sensitive"], []],
      ["private/unprotected", [], []], ["private/denied", [], []],
    ] as Array<[string, string[], string[]]>) {
      await ctx.db.insert("documents", { ...doc, siteId: a, slug, tags: docTags, sensitiveInclude, sensitive: true });
    }
    await ctx.db.insert("documents", { ...doc, siteId: a, slug: "private/path/deleted", sensitive: true, deletedAt: 1 });
    await ctx.db.insert("documents", { ...doc, siteId: b, slug: "private/path/foreign", sensitive: true });
    await ctx.db.insert("documents", { ...doc, slug: "private/path/unscoped", sensitive: true });
    return { user, foreign, assignment, tags, a };
  });
  const old = async (userId: Id<"users">) => {
    const metadata = await t.query(api.documents.listPage, { siteSlug: "alpha", cursor: null, numItems: 1000, includeSensitive: true, sensitiveOnly: true });
    return (await t.query(api.access.filterAccessibleSlugs, { siteSlug: "alpha", userId, slugs: metadata.page.map(doc => doc.slug) }))
      .filter(result => result.allowed).map(result => result.slug);
  };
  const combined = async (userId: Id<"users">) => {
    const slugs: string[] = [];
    let cursor: string | null = null;
    let calls = 0;
    for (;;) {
      const result = await t.query(api.access.listAllowedSensitivePage, { siteSlug: "alpha", userId, cursor, numItems: 2 });
      expect(JSON.stringify(result)).not.toContain("BODY_NOT_RETURNED");
      expect(JSON.stringify(result)).not.toContain("reader@example.test");
      slugs.push(...result.slugs);
      if (++calls > 6) throw new Error("Combined scan included public rows");
      if (result.isDone) return slugs;
      cursor = result.continueCursor;
    }
  };
  expect(await combined(fixture.user)).toEqual(["private/path/ok", "private/tag/direct", "private/tag/include", "private/tag/legacy"]);
  expect(await combined(fixture.user)).toEqual(await old(fixture.user));
  expect(await combined(fixture.foreign)).toEqual([]);
  expect(await combined(fixture.foreign)).toEqual(await old(fixture.foreign));
  await expect(unauthed.query(api.access.listAllowedSensitivePage, { siteSlug: "alpha", userId: fixture.user, cursor: null, numItems: 100 })).rejects.toThrow("Unauthorized");
  expect((await t.query(api.access.listAllowedSensitivePage, { siteSlug: "missing", userId: fixture.user, cursor: null, numItems: 100 })).slugs).toEqual([]);
  await t.run(ctx => ctx.db.delete(fixture.assignment));
  expect(await combined(fixture.user)).toEqual(["private/tag/direct", "private/tag/include", "private/tag/legacy"]);
  expect(await combined(fixture.user)).toEqual(await old(fixture.user));
  await t.run(ctx => ctx.db.patch(fixture.tags, { emailPatterns: [] }));
  expect(await combined(fixture.user)).toEqual([]);
  expect(await combined(fixture.user)).toEqual(await old(fixture.user));
  const publicAndMissing = await t.query(api.access.filterAccessibleSlugs, { siteSlug: "alpha", userId: fixture.user, slugs: ["a-public-0", "missing"] });
  expect(publicAndMissing).toEqual([{ slug: "a-public-0", allowed: true, hasDocument: true }, { slug: "missing", allowed: false, hasDocument: false }]);
  await t.run(ctx => ctx.db.patch(fixture.a, { status: "archived" }));
  await expect(combined(fixture.user)).rejects.toThrow("not active");
});
