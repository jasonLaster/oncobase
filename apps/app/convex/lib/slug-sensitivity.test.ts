import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";

const modules = {
  "../documents.ts": () => import("../documents"),
  "../_generated/server.js": () => import("../_generated/server"),
};

test("slug sensitivity lookup is site-scoped, omits missing/deleted rows and bounds batch size", async () => {
  const unauthed = convexTest(schema, modules);
  const t = unauthed.withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  await t.run(async ctx => {
    const site = (slug: string) => ctx.db.insert("sites", {
      slug, name: slug, ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
    });
    const a = await site("alpha"), b = await site("beta");
    const doc = (siteId: typeof a, slug: string, sensitive: boolean, deletedAt?: number) => ctx.db.insert("documents", {
      siteId, slug, title: slug, content: "BODY", contentHash: "hash", tags: [], sensitive, updatedAt: 1, ...(deletedAt ? { deletedAt } : {}),
    });
    await doc(a, "public", false);
    await doc(a, "private", true);
    await doc(a, "gone", true, 5);
    await doc(b, "foreign", true);
  });

  const result = await t.query(api.documents.getSensitivityBySlugs, {
    siteSlug: "alpha",
    slugs: ["public", "private", "private", "gone", "foreign", "missing"],
  });
  expect(result).toEqual([
    { slug: "public", sensitive: false },
    { slug: "private", sensitive: true },
  ]);
  for (const row of result) expect(Object.keys(row).sort()).toEqual(["sensitive", "slug"]);

  await expect(t.query(api.documents.getSensitivityBySlugs, {
    siteSlug: "alpha",
    slugs: Array.from({ length: 101 }, (_, index) => `slug-${index}`),
  })).rejects.toThrow("At most 100");
  await expect(unauthed.query(api.documents.getSensitivityBySlugs, { siteSlug: "alpha", slugs: ["private"] }))
    .rejects.toThrow("Unauthorized");
});
