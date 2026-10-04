import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { insertDocument, patchDocument } from "./documentMeta";

const serviceIdentity = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };
const modules = { "../documents.ts": () => import("../documents"), "../_generated/server.js": () => import("../_generated/server") };

type Extra = { sensitive?: boolean; deletedAt?: number; sizeBytes?: number };
async function fixture(docs: Array<[slug: string, content: string, extra?: Extra]>, { metaReady = true } = {}) {
  const t = convexTest(schema, modules);
  const siteId = await t.run(async ctx => {
    const siteId = await ctx.db.insert("sites", { slug: "alpha", name: "Alpha", domains: [], ownerEmail: "fixture@test.invalid", status: "active", publishTokenHash: "fixture",
      config: { passwordGate: false, enableChat: false, enableComments: false, enableDownloads: false }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
      ...(metaReady ? { documentMetaReadyAt: 1 } : {}) });
    for (const [slug, content, extra = {}] of docs) {
      // Legacy rows omit `sensitive`; writers always store a boolean.
      await insertDocument(ctx, { siteId, slug, title: slug, content, tags: [], updatedAt: 1, ...extra });
    }
    return siteId;
  });
  return { t, siteId, service: t.withIdentity(serviceIdentity) };
}

test("indexed search never spends result slots or reads on restricted or deleted rows", async () => {
  const { service } = await fixture([
    ...Array.from({ length: 6 }, (_, index): [string, string, Extra] => [`restricted-${index}`, "needle", { sensitive: true }]),
    ...Array.from({ length: 6 }, (_, index): [string, string, Extra] => [`deleted-${index}`, "needle", { deletedAt: 5, sensitive: false }]),
    ["public", "needle", { sensitive: false }],
    ["legacy-unset", "needle"],
    ["legacy-zero", "needle", { deletedAt: 0, sensitive: false }],
    ["legacy-zero-restricted", "needle", { deletedAt: 0, sensitive: true }],
  ]);
  const slugs = async (args: { limit?: number; includeSensitive?: boolean }) =>
    (await service.query(api.documents.search, { siteSlug: "alpha", query: "needle", ...args })).map(result => result.slug).sort();
  expect(await slugs({ limit: 3 })).toEqual(["legacy-unset", "legacy-zero", "public"]);
  expect(await slugs({ limit: 1 })).toHaveLength(1);
  const session = await slugs({ limit: 20, includeSensitive: true });
  expect(session).toEqual([...Array.from({ length: 6 }, (_, index) => `restricted-${index}`), "legacy-unset", "legacy-zero", "legacy-zero-restricted", "public"].sort());
});

test("the corpus plan covers every public row in bounded, fingerprinted ranges", async () => {
  const big = { sizeBytes: 3_000_000, sensitive: false };
  const { t, service, siteId } = await fixture([
    ["a", "alpha body", big], ["b", "bravo body", big], ["c", "charlie body", big],
    ["c-restricted", "secret", { ...big, sensitive: true }], ["c-deleted", "gone", { ...big, deletedAt: 9 }],
    ["legacy", "unset body"], ["zero", "zero body", { deletedAt: 0, sensitive: false }],
  ]);
  const plan = await service.query(api.documents.searchCorpusPlan, { siteSlug: "alpha" });
  expect(plan.planned).toBe(true);
  expect(plan.documents).toBe(5);
  // One 3 MB row per range in the main partition; legacy partitions in index order.
  expect(plan.ranges.map(({ partition, from, to }) => [partition, from, to])).toEqual([
    [0, null, null], [1, null, "b"], [1, "b", "c"], [1, "c", null], [3, null, null],
  ]);
  const read = async (range: (typeof plan.ranges)[number]) => {
    const { fingerprint: _fingerprint, ...args } = range;
    const result = await service.query(api.documents.listSearchPages, { siteSlug: "alpha", ...args, cursor: null });
    expect(result.isDone).toBe(true);
    return result.page.map(page => page.slug);
  };
  expect((await Promise.all(plan.ranges.map(read))).flat()).toEqual(["legacy", "a", "b", "c", "zero"]);

  // Only the range holding the changed row gets a new fingerprint.
  await t.run(async ctx => {
    // eslint-disable-next-line no-restricted-syntax -- Test fixture edits the row it just wrote.
    const row = await ctx.db.query("documents").withIndex("by_site_slug", q => q.eq("siteId", siteId).eq("slug", "b")).first();
    await patchDocument(ctx, row!, { content: "bravo edited", contentHash: "next", updatedAt: 2 });
  });
  const next = await service.query(api.documents.searchCorpusPlan, { siteSlug: "alpha" });
  expect(next.ranges.map((range, index) => range.fingerprint === plan.ranges[index]!.fingerprint)).toEqual([true, true, false, true, true]);
});

test("before the metadata projection is ready, each partition is one continuation-read range", async () => {
  const { service } = await fixture([["a", "alpha"], ["b", "bravo", { sensitive: false }]], { metaReady: false });
  const plan = await service.query(api.documents.searchCorpusPlan, { siteSlug: "alpha" });
  expect(plan).toEqual({ planned: false, documents: null, ranges: [0, 1, 2, 3].map(partition => ({ partition, from: null, to: null, fingerprint: null })) });
  const first = await service.query(api.documents.listSearchPages, { siteSlug: "alpha", partition: 1, from: null, to: null, cursor: null });
  expect(first.page).toEqual([{ slug: "b", title: "b", content: "bravo" }]);
  await expect(service.query(api.documents.listSearchPages, { siteSlug: "alpha", partition: 4, from: null, to: null, cursor: null })).rejects.toThrow("Invalid search partition");
});
