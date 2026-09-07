import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

const modules = { "../documents.ts": () => import("../documents"), "../_generated/server.js": () => import("../_generated/server") };
test("reader snapshot joins current host and policy to explicitly public content without raw or cross-tenant data", async () => {
  const t = convexTest(schema, modules);
  const { a, doc } = await t.run(async ctx => {
    const makeSite = (slug: string) => ctx.db.insert("sites", { slug, name: slug, ownerEmail: "fixture@example.test", status: "active", domains: [slug + ".test"], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: true, passwordHash: "fixture-gate" },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1 });
    const a = await makeSite("alpha"), b = await makeSite("beta");
    const doc = await ctx.db.insert("documents", { siteId: a, slug: "index", title: "A", content: "PUBLIC_A", rawContent: "RAW_SECRET", sensitive: false, tags: [], updatedAt: 1 });
    await ctx.db.insert("documents", { siteId: b, slug: "index", title: "B", content: "PUBLIC_B", sensitive: false, tags: [], updatedAt: 1 });
    return { a, doc };
  });
  const read = () => t.query(api.documents.getReaderPage, { host: "alpha.test", slug: "index" });
  expect((await read())?.page?.content).toBe("PUBLIC_A");
  const digest = (await read())!.page!.bodyDigest!;
  const cached = () => t.query(api.documents.getReaderPage, { host: "alpha.test", slug: "index", knownBody: { siteSlug: "alpha", digest } });
  expect((await cached())?.page?.content).toBeNull();
  expect((await cached())?.page?.bodyDigest).toBe(digest);
  await t.run(ctx => ctx.db.patch(doc, { content: "REPLACED_AT_SAME_SOURCE_HASH" }));
  expect((await cached())?.page?.content).toBe("REPLACED_AT_SAME_SOURCE_HASH");
  expect((await cached())?.page?.bodyDigest).not.toBe(digest);
  expect((await t.query(api.documents.getReaderPage, { host: "beta.test", slug: "index", knownBody: { siteSlug: "alpha", digest } }))?.page?.content).toBe("PUBLIC_B");
  expect(JSON.stringify(await read())).not.toContain("RAW_SECRET");
  expect(await t.query(api.documents.getReaderPage, { host: "unknown.test", slug: "index", previewSiteSlug: "alpha" })).toBeNull();
  await t.run(ctx => ctx.db.patch(doc, { sensitive: true }));
  expect((await read())?.page).toBeNull();
  await t.run(ctx => ctx.db.patch(doc, { sensitive: false, deletedAt: 1 }));
  expect((await read())?.page).toBeNull();
  await t.run(ctx => ctx.db.patch(a, { status: "archived" }));
  expect(await read()).toBeNull();
});
