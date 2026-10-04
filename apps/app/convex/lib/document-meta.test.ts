/* eslint-disable no-restricted-syntax -- fixture inspection of raw tables inside t.run, not a tenant read path. */
import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { insertDocument } from "./documentMeta";

const modules = {
  "../access.ts": () => import("../access"),
  "../documents.ts": () => import("../documents"),
  "../documentMeta.ts": () => import("../documentMeta"),
  "../migrations.ts": () => import("../migrations"),
  "../prefetch.ts": () => import("../prefetch"),
  "../_generated/server.js": () => import("../_generated/server"),
};
const service = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };
const PREFETCH_SECRET = "synthetic-docmeta-test-0000000000000000000";

function setup() {
  return convexTest(schema, modules).withIdentity(service);
}
type T = ReturnType<typeof setup>;

/** Writes schedule manifest builds; cancel them so convex-test timers do not
 * fire into later suites after this test's transaction context is gone. */
async function cancelScheduled(t: T) {
  await t.run(async ctx => { for (const job of await ctx.db.system.query("_scheduled_functions").collect()) await ctx.scheduler.cancel(job._id); });
}

const siteRow = (slug: string) => ({
  slug, name: slug, ownerEmail: "owner@example.test", status: "active" as const, domains: [], publishTokenHash: "fixture",
  config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false, previewSeedSlugs: ["index", "private/a", "gone"] },
  quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
});

async function backfill(t: T, siteSlug: string, numItems?: number) {
  const batches = [];
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const result = await t.mutation(internal.documentMeta.backfillBatch, { siteSlug, cursor, numItems });
    batches.push(result);
    if (result.isDone) return batches;
    cursor = result.continueCursor;
  }
  throw new Error("backfill did not finish");
}

async function verify(t: T, siteSlug: string) {
  let missing = 0, stale = 0, duplicated = 0, scanned = 0;
  let cursor: string | null = null;
  for (;;) {
    const page = await t.query(internal.documentMeta.verifyBatch, { siteSlug, cursor, numItems: 3 });
    missing += page.missingCount; stale += page.staleCount; duplicated += page.duplicatedCount; scanned += page.scanned;
    if (page.isDone) return { missing, stale, duplicated, scanned };
    cursor = page.continueCursor;
  }
}

/** Seed a mixed fixture straight into `documents` (as pre-deploy data would
 * be), so no meta rows exist until the backfill runs. */
async function seed(t: T) {
  return await t.run(async ctx => {
    const a = await ctx.db.insert("sites", siteRow("alpha"));
    const b = await ctx.db.insert("sites", siteRow("beta"));
    const body = (slug: string) => `BODY_${slug}_`.repeat(20);
    const docs: Array<[string, Record<string, unknown>]> = [
      ["index", { sensitive: false, description: "Home", sizeBytes: 10, contentHash: "h-index", hashFunctionVersion: 2, rawContent: "raw", embeddingHash: "e1" }],
      ["notes/legacy", {}], // sensitive undefined, no sizeBytes
      ["notes/zero-deleted", { sensitive: false, deletedAt: 0 }], // legacy readable tombstone value
      ["notes/tombstone", { sensitive: false, deletedAt: 5 }],
      ["private/a", { sensitive: true, tags: ["echo"], sensitiveInclude: ["Echo"], description: "Secret" }],
      ["private/b", { sensitive: true, tags: [] }],
      ["private/c", { sensitive: true, deletedAt: 7 }],
      ["private/zero", { sensitive: true, deletedAt: 0 }],
      ["files/report", { sensitive: true }], // sibling of files/report.pdf
      ["files/open", { sensitive: false }],
    ];
    for (let i = 0; i < 6; i++) docs.push([`bulk/${i}`, { sensitive: i % 2 === 0 ? false : undefined, tags: [`t${i}`] }]);
    const ids: Record<string, Id<"documents">> = {};
    for (const [slug, extra] of docs) {
      ids[slug] = await ctx.db.insert("documents", { siteId: a, slug, title: `Title ${slug}`, content: body(slug), tags: [], updatedAt: 1, ...extra });
    }
    await ctx.db.insert("documents", { siteId: b, slug: "private/a", title: "Other", content: "OTHER", tags: [], sensitive: true, updatedAt: 1 });
    await ctx.db.insert("documents", { slug: "index", title: "Unscoped", content: "UNSCOPED", tags: [], updatedAt: 1 });
    for (const [path, extra] of [
      ["files/report.pdf", { ownerSlugs: ["files"], sensitive: true }],
      ["files/open.pdf", { ownerSlugs: ["files"], sensitive: false }],
      ["files/incomplete.pdf", {}],
      ["files/hidden-sibling.pdf", { ownerSlugs: ["files"], sensitive: false }],
    ] as const) {
      await ctx.db.insert("pdfAssets", { siteId: a, path, blobUrl: `https://blob.test/${path}`, sizeBytes: 1, uploadedAt: 1, ...extra });
      await ctx.db.insert("fileAssets", { siteId: a, path: path.replace(".pdf", ".png"), blobUrl: `https://blob.test/${path}`, sizeBytes: 1, uploadedAt: 1, ...extra });
    }
    const user = await ctx.db.insert("users", { siteId: a, email: "reader@example.test", passwordHash: "x", passwordSalt: "x", createdAt: 1, updatedAt: 1 });
    const role = await ctx.db.insert("roles", { siteId: a, name: "Echo", emailPatterns: ["@example.test"], createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: a, roleId: role, includeTags: ["echo"], createdAt: 1 });
    const other = await ctx.db.insert("roles", { siteId: a, name: "Files", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId: a, roleId: other, pathPattern: "files/", createdAt: 1 });
    for (const slug of ["private/b", "bulk/1", "notes/tombstone"]) await ctx.db.insert("pageVisitStats", { siteId: a, slug, priority: 1, lastVisitedAt: 1 });
    return { a, b, user, ids };
  });
}

async function pages<P>(fetch: (cursor: string | null) => Promise<{ page: P[]; isDone: boolean; continueCursor: string | null }>, flipAfterFirst?: () => Promise<void>) {
  const out: P[] = [];
  let cursor: string | null = null;
  for (let i = 0; ; i++) {
    const result = await fetch(cursor);
    out.push(...result.page);
    if (result.isDone) return out;
    if (i === 0 && flipAfterFirst) await flipAfterFirst();
    cursor = result.continueCursor;
  }
}

/** Every reader switched to documentMeta, normalized to cursor-free output. */
async function snapshot(t: T, fixture: Awaited<ReturnType<typeof seed>>, flip?: () => Promise<void>) {
  const siteSlug = "alpha";
  const slugs = ["index", "notes/legacy", "notes/zero-deleted", "notes/tombstone", "private/a", "private/b", "private/c", "files/report", "missing", "bulk/3"];
  const saved = process.env.WIKI_PREFETCH_SECRET;
  process.env.WIKI_PREFETCH_SECRET = PREFETCH_SECRET;
  try {
    return {
      manifestPublic: await pages(cursor => t.query(api.documents.listManifestPage, { siteSlug, cursor, numItems: 2 }), flip),
      manifestAll: await pages(cursor => t.query(api.documents.listManifestPage, { siteSlug, cursor, numItems: 3, includeSensitive: true })),
      listPublic: await pages(cursor => t.query(api.documents.listPage, { siteSlug, cursor, numItems: 4 })),
      listAll: await pages(cursor => t.query(api.documents.listPage, { siteSlug, cursor, numItems: 4, includeSensitive: true })),
      listSensitiveOnly: await pages(cursor => t.query(api.documents.listPage, { siteSlug, cursor, numItems: 2, includeSensitive: true, sensitiveOnly: true })),
      embedding: await pages(cursor => t.query(api.documents.embeddingStatusPage, { siteSlug, cursor, numItems: 5, includeSensitive: true })),
      sensitivity: await t.query(api.documents.getSensitivityBySlugs, { siteSlug, slugs }),
      byId: await t.query(internal.documents.searchHitsByIds, { siteSlug, ids: Object.values(fixture.ids) }),
      byIdAll: await t.query(internal.documents.searchHitsByIds, { siteSlug, ids: Object.values(fixture.ids), includeSensitive: true }),
      publisherPages: await t.query(internal.documents.internal_publisherManifestPages, { siteSlug, slugs: slugs.slice(0, 10) }),
      pdfPaths: await pages(cursor => t.query(api.documents.listPdfAssetPathsPage, { siteSlug, cursor, numItems: 2 })),
      filePaths: await pages(cursor => t.query(api.documents.listFileAssetPathsPage, { siteSlug, cursor, numItems: 2 })),
      pdfAssets: await t.query(api.documents.listPdfAssets, { siteSlug }),
      assetHashes: await pages(cursor => t.query(api.documents.assetHashesPage, { siteSlug, cursor, numItems: 10, includeSensitive: false })),
      pdfVisibility: await pages(cursor => t.query(api.documents.listPdfAssetVisibilityPage, { siteSlug, cursor, numItems: 2 })),
      pdfVisibilityAll: await pages(cursor => t.query(api.documents.listPdfAssetVisibilityPage, { siteSlug, cursor, numItems: 2, includeSensitive: true })),
      fileVisibilityAll: await pages(cursor => t.query(api.documents.listFileAssetVisibilityPage, { siteSlug, cursor, numItems: 2, includeSensitive: true })),
      pdfByPath: (await Promise.all(["files/report.pdf", "files/open.pdf", "files/incomplete.pdf"].map(path => t.query(api.documents.getPdfAssetByPath, { siteSlug, path })))).map(row => row?.path ?? null),
      accessible: await t.query(api.access.filterAccessibleSlugs, { siteSlug, userId: fixture.user, slugs }),
      canAccess: await Promise.all(slugs.map(slug => t.query(api.access.canUserAccessSlug, { siteSlug, userId: fixture.user, slug }))),
      allowedSensitive: await pages(async cursor => {
        const result = await t.query(api.access.listAllowedSensitivePage, { siteSlug, userId: fixture.user, cursor, numItems: 2 });
        return { page: result.slugs, isDone: result.isDone, continueCursor: result.continueCursor };
      }),
      allowedManifest: await pages(cursor => t.query(api.access.listAllowedSensitiveManifestPage, { siteSlug, userId: fixture.user, cursor, numItems: 2 })),
      priorities: await t.query(api.prefetch.priorities, { siteSlug, serverSecret: PREFETCH_SECRET }),
    };
  } finally {
    // Assigning undefined would store the string "undefined" for later suites.
    if (saved === undefined) delete process.env.WIKI_PREFETCH_SECRET;
    else process.env.WIKI_PREFETCH_SECRET = saved;
  }
}

test("readers return identical results from documents and documentMeta, and switch only on the site flag", async () => {
  const t = setup();
  const fixture = await seed(t);
  const before = await snapshot(t, fixture);
  // Sanity: the fixture exercises visibility, tombstones and tenancy.
  expect(before.manifestPublic.map(page => page.slug)).toEqual(["bulk/1", "bulk/3", "bulk/5", "notes/legacy", "bulk/0", "bulk/2", "bulk/4", "files/open", "index", "notes/zero-deleted"]);
  expect(before.manifestPublic.find(page => page.slug === "notes/legacy")?.size).toBe("BODY_notes/legacy_".length * 20);
  expect(before.listSensitiveOnly.map(page => page.slug)).toEqual(["files/report", "private/a", "private/b", "private/zero"]);
  expect(before.accessible.filter(row => row.allowed).map(row => row.slug)).toEqual(["index", "notes/legacy", "notes/zero-deleted", "notes/tombstone", "private/a", "bulk/3"]);
  expect(before.pdfVisibility.map(row => row.path)).toEqual(["files/hidden-sibling.pdf", "files/open.pdf"]);
  expect(before.pdfVisibilityAll.find(row => row.path === "files/report.pdf")).toEqual({ path: "files/report.pdf", ownerSlugs: ["files", "files/report"], sensitive: true });
  expect(before.priorities).toEqual([{ slug: "bulk/1", sensitive: false }, { slug: "private/b", sensitive: true }, { slug: "index", sensitive: false }, { slug: "private/a", sensitive: true }]);
  expect(JSON.stringify(before)).not.toContain("BODY_");

  // Flag without meta rows: readers really switch (results become empty).
  await t.mutation(internal.documentMeta.setReady, { siteSlug: "alpha", ready: true });
  expect(await t.query(api.documents.listManifestPage, { siteSlug: "alpha", cursor: null, numItems: 100 })).toMatchObject({ page: [] });
  await t.mutation(internal.documentMeta.setReady, { siteSlug: "alpha", ready: false });

  const batches = await backfill(t, "alpha", 4);
  expect(batches.at(-1)!.readyAt).toBeNumber();
  expect(batches.reduce((sum, batch) => sum + batch.inserted, 0)).toBe(Object.keys(fixture.ids).length);
  const after = await snapshot(t, fixture);
  expect(after).toEqual(before);
  // Fresh cursors now come from documentMeta and stay tagged.
  const first = await t.query(api.documents.listPage, { siteSlug: "alpha", cursor: null, numItems: 2 });
  expect(first.continueCursor.startsWith("docmeta1:")).toBe(true);
  // Other sites are unaffected until they are backfilled.
  expect((await t.query(internal.documentMeta.status, {})).map(row => [row.siteSlug, row.readyAt !== null])).toEqual([["alpha", true], ["beta", false]]);
  await cancelScheduled(t);
});

test("a pagination keeps its source when the flag flips or is rolled back mid-way", async () => {
  const t = setup();
  const fixture = await seed(t);
  const baseline = await snapshot(t, fixture);
  await backfill(t, "alpha", 100);
  await t.mutation(internal.documentMeta.setReady, { siteSlug: "alpha", ready: false });
  // Started on documents, flag turned on after the first page.
  const forward = await snapshot(t, fixture, () => t.mutation(internal.documentMeta.setReady, { siteSlug: "alpha", ready: true }).then(() => undefined));
  expect(forward).toEqual(baseline);
  // Started on documentMeta, rolled back after the first page.
  const backward = await snapshot(t, fixture, () => t.mutation(internal.documentMeta.setReady, { siteSlug: "alpha", ready: false }).then(() => undefined));
  expect(backward).toEqual(baseline);
  await cancelScheduled(t);
});

test("every documents write keeps documentMeta in sync", async () => {
  const t = setup();
  await t.run(async ctx => {
    await ctx.db.insert("sites", siteRow("alpha"));
    await ctx.db.insert("sites", siteRow("diana"));
  });
  const meta = (slug: string) => t.run(async ctx => {
    const rows = await ctx.db.query("documentMeta").collect();
    return rows.filter(row => row.slug === slug);
  });
  const consistent = async () => expect({ ...(await verify(t, "alpha")), scanned: 0 }).toEqual({ missing: 0, stale: 0, duplicated: 0, scanned: 0 });
  const siteSlug = "alpha";
  await t.mutation(api.documents.upsert, { siteSlug, slug: "page", title: "Page", content: "one", rawContent: "raw", tags: ["a"], contentHash: "h1", sensitiveInclude: ["x"] });
  await consistent();
  expect(await meta("page")).toMatchObject([{ title: "Page", size: 3, hasRawContent: true, sensitive: false, sensitiveInclude: ["x"], contentHash: "h1" }]);
  await t.mutation(api.documents.upsert, { siteSlug, slug: "page", title: "Renamed", content: "longer body", tags: ["b"], contentHash: "h2", sensitive: true, replaceRawContent: true });
  await consistent();
  expect(await meta("page")).toMatchObject([{ title: "Renamed", size: 11, hasRawContent: false, sensitive: true, tags: ["b"] }]);
  await t.mutation(api.documents.bulkSetContentHash, { siteSlug, hashFunctionVersion: 4, entries: [{ slug: "page", contentHash: "h4" }, { slug: "missing", contentHash: "x" }] });
  await t.mutation(api.documents.upsertEmbedding, { siteSlug, slug: "page", embedding: new Array(1536).fill(0.5), embeddingHash: "emb" });
  await consistent();
  expect(await meta("page")).toMatchObject([{ contentHash: "h4", hashFunctionVersion: 4, embeddingHash: "emb" }]);
  await t.mutation(api.documents.deleteBySlug, { siteSlug, slug: "page" });
  await consistent();
  expect((await meta("page"))[0].deletedAt).toBeNumber();
  // Republishing clears the tombstone in both rows.
  await t.mutation(api.documents.upsert, { siteSlug, slug: "page", title: "Back", content: "x", tags: [], contentHash: "h5" });
  await consistent();
  expect((await meta("page"))[0].deletedAt).toBeUndefined();
  expect(await meta("page")).toHaveLength(1);

  // Unscoped legacy rows get meta only when the siteId migration scopes them.
  await t.run(ctx => ctx.db.insert("documents", { slug: "legacy", title: "Legacy", content: "abc", tags: [], updatedAt: 1 }));
  expect(await meta("legacy")).toHaveLength(0);
  let cursor: string | undefined;
  for (;;) {
    const result = await t.mutation(internal.migrations.backfillSiteIdsBatch, { table: "documents", cursor });
    if (!result.hasMore) break;
    cursor = result.cursor ?? undefined;
  }
  expect(await meta("legacy")).toMatchObject([{ size: 3 }]);
  expect(await verify(t, "diana")).toMatchObject({ missing: 0, stale: 0, scanned: 1 });
  await cancelScheduled(t);
});

test("backfill is resumable, idempotent and repairs drift", async () => {
  const t = setup();
  const fixture = await seed(t);
  const total = Object.keys(fixture.ids).length;
  // Resume: one batch, then writes land on both sides of the cursor.
  const firstBatch = await t.mutation(internal.documentMeta.backfillBatch, { siteSlug: "alpha", numItems: 3 });
  expect(firstBatch).toMatchObject({ phase: "documents", scanned: 3, inserted: 3, isDone: false, readyAt: null });
  await t.run(async ctx => {
    await insertDocument(ctx, { siteId: fixture.a, slug: "aaa-early", title: "early", content: "e", tags: [], updatedAt: 2 });
    await insertDocument(ctx, { siteId: fixture.a, slug: "zzz-late", title: "late", content: "l", tags: [], updatedAt: 2 });
  });
  let cursor = firstBatch.continueCursor;
  let result;
  do {
    result = await t.mutation(internal.documentMeta.backfillBatch, { siteSlug: "alpha", cursor, numItems: 3 });
    cursor = result.continueCursor;
  } while (!result.isDone);
  expect(result.readyAt).toBeNumber();
  expect(await verify(t, "alpha")).toEqual({ missing: 0, stale: 0, duplicated: 0, scanned: total + 2 });
  const readyAt = result.readyAt;

  // Idempotent: a second run writes nothing and keeps the original stamp.
  const rerun = await backfill(t, "alpha", 5);
  expect(rerun.reduce((sum, batch) => sum + batch.inserted + batch.updated + batch.deleted, 0)).toBe(0);
  expect(rerun.at(-1)!.readyAt).toBe(readyAt);

  // Drift introduced outside the helpers is detected and repaired.
  await t.run(async ctx => {
    const rows = await ctx.db.query("documentMeta").withIndex("by_site_slug", q => q.eq("siteId", fixture.a)).collect();
    await ctx.db.delete(rows.find(row => row.slug === "index")!._id);
    await ctx.db.patch(rows.find(row => row.slug === "private/a")!._id, { sensitive: false });
    await ctx.db.insert("documentMeta", { ...rows.find(row => row.slug === "bulk/0")!, _id: undefined, _creationTime: undefined } as never);
    await ctx.db.delete(fixture.ids["bulk/5"]); // hard delete leaves an orphan
  });
  expect(await verify(t, "alpha")).toMatchObject({ missing: 1, stale: 1, duplicated: 1 });
  const repair = await backfill(t, "alpha", 50);
  expect(repair.reduce((sum, batch) => sum + batch.inserted, 0)).toBe(1);
  expect(await verify(t, "alpha")).toEqual({ missing: 0, stale: 0, duplicated: 0, scanned: total + 1 });
  expect(await t.run(ctx => ctx.db.query("documentMeta").withIndex("by_document", q => q.eq("documentId", fixture.ids["bulk/5"])).collect())).toEqual([]);

  // markReady:false backfills without switching readers.
  await t.run(async ctx => { await insertDocument(ctx, { siteId: fixture.b, slug: "x", title: "x", content: "x", tags: [], updatedAt: 1 }); });
  let betaCursor: string | null = null;
  for (;;) {
    const batch = await t.mutation(internal.documentMeta.backfillBatch, { siteSlug: "beta", cursor: betaCursor, markReady: false });
    if (batch.isDone) { expect(batch.readyAt).toBeNull(); break; }
    betaCursor = batch.continueCursor;
  }
  await expect(t.mutation(internal.documentMeta.backfillBatch, { siteSlug: "beta", cursor: "[\"bogus\"]" })).rejects.toThrow("Invalid backfill cursor");
  await expect(t.mutation(internal.documentMeta.backfillBatch, { siteSlug: "missing" })).rejects.toThrow("not found");
  await cancelScheduled(t);
});

test("content pages use the visibility index and finish legacy cursors on the old path", async () => {
  const t = setup();
  await seed(t);
  const siteSlug = "alpha";
  const publicPages = await pages(cursor => t.query(api.documents.listPageWithContent, { siteSlug, cursor, numItems: 3 }));
  expect(publicPages.map(page => page.slug).sort()).toEqual(["bulk/0", "bulk/1", "bulk/2", "bulk/3", "bulk/4", "bulk/5", "files/open", "index", "notes/legacy", "notes/zero-deleted"]);
  const allPages = await pages(cursor => t.query(api.documents.listPageWithContent, { siteSlug, cursor, numItems: 4, includeSensitive: true }));
  expect(allPages.map(page => page.slug).sort()).toEqual([...publicPages.map(page => page.slug), "files/report", "private/a", "private/b", "private/zero"].sort());
  // A raw by_site_slug cursor from a pre-deploy caller keeps working.
  const legacy = await t.run(async ctx => {
    const site = await ctx.db.query("sites").withIndex("by_slug", q => q.eq("slug", siteSlug)).first();
    return await ctx.db.query("documents").withIndex("by_site_slug", q => q.eq("siteId", site!._id)).paginate({ cursor: null, numItems: 4 });
  });
  const rest = await pages(cursor => t.query(api.documents.listPageWithContent, { siteSlug, cursor: cursor ?? legacy.continueCursor, numItems: 4 }));
  expect(rest.every(page => page.sensitive !== true)).toBe(true);
  expect(rest.map(page => page.slug)).toEqual([...rest.map(page => page.slug)].sort());
  await expect(t.query(api.documents.listManifestPage, { siteSlug, cursor: "not-a-cursor", numItems: 2 })).rejects.toThrow("Invalid manifest cursor");
  await cancelScheduled(t);
});
