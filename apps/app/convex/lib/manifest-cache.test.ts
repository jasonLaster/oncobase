import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { expect, test } from "bun:test";
import { current, install, requestBuild, status } from "../manifestCache";
import { invalidateManifest, queueManifestBuild } from "./manifestRevision";
import { upsert, setContentHash, bulkSetContentHash, setDescription, deleteBySlug, upsertPdfAsset, upsertFileAsset, deletePdfAssetByPath, deleteFileAssetByPath, backfillAssetHashes } from "../documents";

function handler(fn: unknown) {
  return (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
}
function fixture() {
  const rows: Record<string, any[]> = {
    sites: [{ _id: "a", slug: "alpha", status: "active" }, { _id: "b", slug: "beta", status: "active" }],
    documents: [{ _id: "doc", siteId: "a", slug: "one", contentHash: "one", content: "Body", sizeBytes: 4, sensitive: false, tags: [] }],
    pdfAssets: [{ _id: "pdf", siteId: "a", path: "one.pdf" }],
    fileAssets: [{ _id: "file", siteId: "a", path: "one.png" }],
  };
  const jobs: any[] = [], deleted: string[] = [];
  const ctx: any = {
    auth: { getUserIdentity: async () => ({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" }) },
    db: {
      get: async (id: string) => { const row = Object.values(rows).flat().find(row => row._id === id); return row ? structuredClone(row) : null; },
      patch: async (id: string, patch: any) => Object.assign(Object.values(rows).flat().find(row => row._id === id)!, patch),
      insert: async (table: string, data: any) => rows[table].push({ _id: `new-${rows[table].length}`, ...data }),
      query: (table: string) => {
        const filters: [string, unknown][] = [];
        const builder = {
          withIndex: (_name: string, filter: any) => { const q = { eq: (key: string, value: unknown) => { filters.push([key, value]); return q; } }; filter(q); return builder; },
          first: async () => { const row = rows[table].find(row => filters.every(([key, value]) => row[key] === value)); return row ? structuredClone(row) : null; },
          collect: async () => rows[table].filter(row => filters.every(([key, value]) => row[key] === value)),
        };
        return builder;
      },
    },
    scheduler: { runAfter: async (_delay: number, _ref: unknown, args: any) => jobs.push(args) },
    storage: { getUrl: async (id: string) => deleted.includes(id) ? null : `https://storage.invalid/${id}`, delete: async (id: string) => deleted.push(id) },
  };
  return { ctx, rows, jobs, deleted };
}

test("snapshot builds coalesce writes, reject concurrent revisions, and recover an expired lease", async () => {
  const { ctx, rows, jobs, deleted } = fixture();
  await invalidateManifest(ctx, "a" as never);
  await invalidateManifest(ctx, "a" as never);
  expect(rows.sites[0].manifestRevision).toBe(2);
  expect(rows.sites[1].manifestRevision).toBeUndefined();
  expect(jobs).toHaveLength(1);
  expect(await handler(install)(ctx, { siteSlug: "alpha", formatVersion: 1, revision: 1, hash: "old", storageId: "old-blob" })).toBe(false);
  expect(deleted).toContain("old-blob");
  expect(rows.sites[0].manifestSnapshot).toBeUndefined();
  expect(jobs).toHaveLength(2);
  expect(await handler(install)(ctx, { siteSlug: "alpha", formatVersion: 1, revision: 2, hash: "new", storageId: "new-blob" })).toBe(true);
  expect(rows.sites[0].manifestBuildQueuedAt).toBeUndefined();
  rows.sites[0].manifestBuildQueuedAt = Date.now() - 120_001;
  await queueManifestBuild(ctx, "a" as never);
  expect(jobs).toHaveLength(3);
});

test("snapshot URLs require a service credential, active tenant, matching revision and format", async () => {
  const saved = process.env.WIKI_PREFETCH_SECRET;
  const secret = "synthetic-manifest-test-00000000000000000";
  process.env.WIKI_PREFETCH_SECRET = secret;
  try {
    const { ctx, rows, deleted } = fixture();
    const args = { siteSlug: "alpha", serverSecret: secret };
    await expect(handler(current)(ctx, { ...args, serverSecret: "wrong" })).rejects.toThrow("Unauthorized");
    await expect(handler(requestBuild)(ctx, { ...args, serverSecret: "wrong" })).rejects.toThrow("Unauthorized");
    await handler(install)(ctx, { siteSlug: "alpha", formatVersion: 1, revision: 0, hash: "v0", storageId: "blob" });
    expect(await handler(current)(ctx, args)).toEqual({ hash: "v0", url: "https://storage.invalid/blob" });
    expect(await handler(current)(ctx, { ...args, siteSlug: "beta" })).toBeNull();
    rows.sites[0].manifestSnapshot.formatVersion = 999;
    expect(await handler(current)(ctx, args)).toBeNull();
    rows.sites[0].manifestSnapshot.formatVersion = 1;
    deleted.push("blob");
    expect(await handler(current)(ctx, args)).toBeNull();
    await invalidateManifest(ctx, "a" as never);
    expect(await handler(current)(ctx, args)).toBeNull();
    rows.sites[0].status = "archived";
    await expect(handler(current)(ctx, args)).rejects.toThrow("not active");
  } finally {
    if (saved === undefined) delete process.env.WIKI_PREFETCH_SECRET;
    else process.env.WIKI_PREFETCH_SECRET = saved;
  }
});

test("every document and asset write invalidates its tenant's manifest", async () => {
  const cases: [unknown, Record<string, unknown>][] = [
    [upsert, { slug: "one", title: "Updated", content: "New body", contentHash: "two", tags: [], sensitive: true }],
    [upsert, { slug: "new", title: "New", content: "New body", contentHash: "two", tags: [] }],
    [setContentHash, { slug: "one", contentHash: "two" }],
    [bulkSetContentHash, { entries: [{ slug: "one", contentHash: "two" }] }],
    [setDescription, { slug: "one", description: "Updated description" }],
    [deleteBySlug, { slug: "one" }],
    [upsertPdfAsset, { path: "one.pdf", url: "https://fixture.invalid/one", contentHash: "two" }],
    [upsertFileAsset, { path: "one.png", url: "https://fixture.invalid/one", contentHash: "two" }],
    [deletePdfAssetByPath, { path: "one.pdf" }],
    [deleteFileAssetByPath, { path: "one.png" }],
    [backfillAssetHashes, { entries: [{ kind: "pdf", path: "one.pdf", contentHash: "two", ownerSlugs: ["one"], sensitive: true, sensitiveInclude: [], visibilityHash: "two" }] }],
  ];
  for (const [fn, args] of cases) {
    const { ctx, rows, jobs } = fixture();
    await handler(fn)(ctx, { siteSlug: "alpha", ...args });
    expect(rows.sites[0].manifestRevision).toBe(1);
    expect(rows.sites[1].manifestRevision).toBeUndefined();
    expect(jobs).toHaveLength(1);
  }
});

test("unchanged documents and missing deletion targets do not queue rebuilds", async () => {
  const { ctx, jobs } = fixture();
  await handler(upsert)(ctx, { siteSlug: "alpha", slug: "one", title: "One", content: "Body", contentHash: "one", tags: [] });
  await handler(setContentHash)(ctx, { siteSlug: "alpha", slug: "one", contentHash: "one" });
  await handler(deleteBySlug)(ctx, { siteSlug: "alpha", slug: "missing" });
  await handler(deleteFileAssetByPath)(ctx, { siteSlug: "alpha", path: "missing" });
  expect(jobs).toHaveLength(0);
});


test("operator snapshot inventory excludes archived sites and site credentials", async () => {
  const { ctx, rows } = fixture();
  rows.sites[0].config = { passwordHash: "synthetic-private-setting" };
  rows.sites[1].status = "archived";
  await handler(install)(ctx, { siteSlug: "alpha", formatVersion: 1, revision: 0, hash: "ready", storageId: "blob" });
  expect(await handler(status)(ctx, {})).toEqual([{ siteSlug: "alpha", revision: 0, hash: "ready", url: "https://storage.invalid/blob" }]);
  await invalidateManifest(ctx, "a" as never);
  expect(await handler(status)(ctx, { siteSlug: "alpha" })).toEqual([{ siteSlug: "alpha", revision: 1, hash: null, url: null }]);
});
