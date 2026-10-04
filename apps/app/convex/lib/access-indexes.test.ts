/* eslint-disable no-restricted-syntax -- Test fixtures inspect whole tables to prove cross-tenant rows survive. */
import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";

const modules = {
  "../access.ts": () => import("../access"),
  "../users.ts": () => import("../users"),
  "../_generated/server.js": () => import("../_generated/server"),
};

async function fixture() {
  const base = convexTest(schema, modules);
  const t = base.withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  const ids = await t.run(async ctx => {
    const site = (slug: string) => ctx.db.insert("sites", {
      slug, name: slug, ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
    });
    const a = await site("alpha"), b = await site("beta");
    const user = (siteId: typeof a, email: string) => ctx.db.insert("users", { siteId, email, passwordHash: "h", passwordSalt: "s", createdAt: 1, updatedAt: 1 });
    const alice = await user(a, "alice@example.test"), bob = await user(a, "bob@example.test"), foreign = await user(b, "alice@example.test");
    const role = await ctx.db.insert("roles", { siteId: a, name: "Care", createdAt: 1, updatedAt: 1 });
    const keep = await ctx.db.insert("roles", { siteId: a, name: "Keep", createdAt: 1, updatedAt: 1 });
    const foreignRole = await ctx.db.insert("roles", { siteId: b, name: "Other", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: a, roleId: role, includeTags: ["care"], createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: b, roleId: foreignRole, pathPattern: "*", createdAt: 1 });
    for (const [userId, roleId, siteId] of [[alice, role, a], [bob, role, a], [bob, keep, a], [foreign, foreignRole, b]] as const) {
      await ctx.db.insert("userRoles", { siteId, userId, roleId, createdAt: 1 });
    }
    for (const [userId, siteId, tokenHash] of [[alice, a, "a1"], [alice, a, "a2"], [bob, a, "b1"], [foreign, b, "f1"]] as const) {
      await ctx.db.insert("userSessions", { siteId, userId, tokenHash, createdAt: 1, expiresAt: Date.now() + 60_000 });
    }
    return { a, b, alice, bob, foreign, role, keep, foreignRole };
  });
  return { t, ...ids };
}

test("role reads and role deletion stay inside the tenant", async () => {
  const { t, role, bob } = await fixture();
  const roles = await t.query(api.access.listRoles, { siteSlug: "alpha" });
  expect(roles.map(r => r.name).sort()).toEqual(["Care", "Keep"]);
  expect(roles.find(r => r.name === "Care")?.includeTags).toEqual(["care"]);
  const users = await t.query(api.access.listUsersWithRoles, { siteSlug: "alpha" });
  expect(users.find(u => u._id === bob)?.roles.sort()).toEqual(["Care", "Keep"]);

  await t.mutation(api.access.deleteRole, { siteSlug: "alpha", roleId: role });
  const remaining = await t.run(ctx => ctx.db.query("userRoles").collect());
  expect(remaining.map(r => r.roleId)).not.toContain(role);
  expect(remaining).toHaveLength(2); // bob's Keep + the other tenant's assignment
  expect((await t.query(api.access.listRoles, { siteSlug: "beta" })).map(r => r.name)).toEqual(["Other"]);
});

test("deleting users and resetting passwords revoke only that user's sessions", async () => {
  const { t, alice } = await fixture();
  expect(await t.mutation(internal.users.resetPassword, { siteSlug: "alpha", email: "alice@example.test", passwordHash: "h2", passwordSalt: "s2" }))
    .toMatchObject({ revokedSessions: 2 });
  expect((await t.run(ctx => ctx.db.query("userSessions").collect())).map(s => s.tokenHash).sort()).toEqual(["b1", "f1"]);
  const bob = (await t.query(api.access.listUsersWithRoles, { siteSlug: "alpha" })).find(u => u.email === "bob@example.test")!;
  expect(await t.mutation(api.access.deleteUsers, { siteSlug: "alpha", userIds: [bob._id] })).toEqual({ deleted: 1, revokedSessions: 1 });
  expect((await t.run(ctx => ctx.db.query("userSessions").collect())).map(s => s.tokenHash)).toEqual(["f1"]);
  await expect(t.mutation(api.access.deleteUsers, { siteSlug: "beta", userIds: [alice] })).rejects.toThrow("does not belong");
});
