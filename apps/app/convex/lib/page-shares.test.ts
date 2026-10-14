import { expect, spyOn, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";

const modules = { "../pageShares.ts": () => import("../pageShares"), "../_generated/server.js": () => import("../_generated/server") };
const hash = "a".repeat(64), replacement = "b".repeat(64);

async function fixture() {
  const anonymous = convexTest(schema, modules);
  const t = anonymous.withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  const ids = await t.run(async ctx => {
    const site = (slug: string) => ctx.db.insert("sites", { slug, name: slug, ownerEmail: "owner@test.invalid", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: true }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1 });
    const alpha = await site("alpha"), beta = await site("beta");
    const user = (email: string) => ctx.db.insert("users", { siteId: alpha, email, passwordHash: "fixture", passwordSalt: "fixture", createdAt: 1, updatedAt: 1 });
    const owner = await user("owner@test.invalid"), reader = await user("reader@test.invalid");
    const session = (userId: typeof owner, tokenHash: string) => ctx.db.insert("userSessions", { siteId: alpha, userId, tokenHash, createdAt: 1, expiresAt: Date.now() + 100_000 });
    const ownerSession = await session(owner, "owner-session"); await session(reader, "reader-session");
    const doc = { title: "Private fixture", content: "REDACTED_BODY", rawContent: "RAW_SECRET", tags: ["private"], sensitive: true, updatedAt: 1 };
    const page = await ctx.db.insert("documents", { ...doc, siteId: alpha, slug: "private/page" });
    const other = await ctx.db.insert("documents", { ...doc, siteId: alpha, slug: "private/other", content: "OTHER_SECRET" });
    await ctx.db.insert("documents", { ...doc, siteId: beta, slug: "private/page", content: "TENANT_SECRET" });
    await ctx.db.insert("fileAssets", { siteId: alpha, path: "private/image.png", blobUrl: "https://blob.test/image", sizeBytes: 1, uploadedAt: 1, sensitive: true, ownerSlugs: ["private/page"] });
    for (const [path, ownerSlugs] of [["other.png", ["private/other"]], ["mixed.png", ["private/page", "private/other"]], ["unowned.png", []]] as const) {
      await ctx.db.insert("fileAssets", { siteId: alpha, path, blobUrl: "https://blob.test/denied", sizeBytes: 1, uploadedAt: 1, ownerSlugs: [...ownerSlugs] });
    }
    return { alpha, beta, page, other, ownerSession, reader };
  });
  const args = { siteSlug: "alpha", slug: "private/page", sessionTokenHash: "owner-session" };
  return { t, anonymous, ids, args };
}

test("links authorize one document and tenant; never return raw content or unrelated assets", async () => {
  const { t, anonymous, args } = await fixture();
  await expect(anonymous.query(api.pageShares.read, { siteSlug: "alpha", tokenHash: hash })).rejects.toThrow("Unauthorized");
  await t.mutation(api.pageShares.create, { ...args, tokenHash: hash });
  const page = await t.query(api.pageShares.read, { siteSlug: "alpha", tokenHash: hash });
  expect(page?.content).toBe("REDACTED_BODY");
  expect(JSON.stringify(page)).not.toContain("SECRET");
  expect(await t.query(api.pageShares.read, { siteSlug: "beta", tokenHash: hash })).toBeNull();
  expect(await t.query(api.pageShares.read, { siteSlug: "alpha", tokenHash: replacement })).toBeNull();
  expect(await t.query(api.pageShares.asset, { siteSlug: "alpha", tokenHash: hash, path: "private/image.png" })).toEqual({ blobUrl: "https://blob.test/image" });
  for (const path of ["other.png", "mixed.png", "unowned.png", "missing.png"]) expect(await t.query(api.pageShares.asset, { siteSlug: "alpha", tokenHash: hash, path })).toBeNull();
});

test("links have no expiry; replacement, revocation, deletion and archival stop access", async () => {
  const { t, args, ids } = await fixture();
  const read = (tokenHash: string) => t.query(api.pageShares.read, { siteSlug: "alpha", tokenHash });
  await t.mutation(api.pageShares.create, { ...args, tokenHash: hash });
  expect(await t.query(api.pageShares.status, args)).toBe(true);
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 100 * 365 * 86_400_000);
  try {
    expect(await read(hash)).not.toBeNull();
    expect(await t.query(api.pageShares.asset, { siteSlug: "alpha", tokenHash: hash, path: "private/image.png" })).not.toBeNull();
  } finally { clock.mockRestore(); }
  await t.mutation(api.pageShares.create, { ...args, tokenHash: replacement });
  expect(await read(hash)).toBeNull(); expect(await read(replacement)).not.toBeNull();
  await t.mutation(api.pageShares.revoke, args);
  expect(await t.query(api.pageShares.status, args)).toBe(false);
  expect(await read(replacement)).toBeNull();
  expect(await t.query(api.pageShares.asset, { siteSlug: "alpha", tokenHash: replacement, path: "private/image.png" })).toBeNull();
  await t.mutation(api.pageShares.create, { ...args, tokenHash: replacement });
  await t.run(ctx => ctx.db.patch(ids.page, { deletedAt: 1 }));
  expect(await read(replacement)).toBeNull();
  // A new page reusing a deleted slug must not inherit the link.
  await t.run(ctx => ctx.db.insert("documents", { siteId: ids.alpha, slug: "private/page", title: "New", content: "NEW_SECRET", tags: [], updatedAt: 1 }));
  expect(await read(replacement)).toBeNull();
  await t.run(ctx => ctx.db.patch(ids.alpha, { status: "archived" }));
  await expect(read(replacement)).rejects.toThrow("not active");
});

test("management requires a live owner/admin session and validates the link secret", async () => {
  const { t, args, ids } = await fixture();
  for (const sessionTokenHash of ["missing", "reader-session"]) {
    const unauthorized = { ...args, sessionTokenHash };
    await expect(t.mutation(api.pageShares.create, { ...unauthorized, tokenHash: hash })).rejects.toThrow("Forbidden");
    await expect(t.mutation(api.pageShares.revoke, unauthorized)).rejects.toThrow("Forbidden");
    await expect(t.query(api.pageShares.status, unauthorized)).rejects.toThrow("Forbidden");
  }
  await expect(t.mutation(api.pageShares.create, { ...args, tokenHash: "weak" })).rejects.toThrow("Invalid link");
  const assignment = await t.run(async ctx => {
    const role = await ctx.db.insert("roles", { siteId: ids.alpha, name: "Admin", createdAt: 1, updatedAt: 1 });
    return ctx.db.insert("userRoles", { siteId: ids.alpha, userId: ids.reader, roleId: role, createdAt: 1 });
  });
  await t.mutation(api.pageShares.create, { ...args, sessionTokenHash: "reader-session", tokenHash: hash });
  await t.run(ctx => ctx.db.delete(assignment));
  await expect(t.mutation(api.pageShares.revoke, { ...args, sessionTokenHash: "reader-session" })).rejects.toThrow("Forbidden");
  await t.run(ctx => ctx.db.patch(ids.ownerSession, { expiresAt: 1 }));
  await expect(t.mutation(api.pageShares.create, { ...args, tokenHash: replacement })).rejects.toThrow("Forbidden");
});
