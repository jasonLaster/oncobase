import { expect, test } from "bun:test";
import { priorities, recordVisit } from "../prefetch";

// Exercise the registered handlers without deploying or writing real visits.
// The fake database implements indexed equality/order and records read bounds.
function database() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    sites: [{ _id: "a", slug: "alpha", status: "active", config: { previewSeedSlugs: [] } }, { _id: "b", slug: "beta", status: "active", config: { previewSeedSlugs: [] } }],
    documents: [{ _id: "one", siteId: "a", slug: "shared" }, { _id: "two", siteId: "b", slug: "shared" }, { _id: "three", siteId: "a", slug: "private", sensitive: true }, { _id: "four", siteId: "a", slug: "deleted", deletedAt: 1 }],
    pageVisitStats: [],
  };
  const limits: number[] = [];
  const ctx = { db: {
    query: (table: string) => {
      let filters: [string, unknown][] = [];
      let order = "asc";
      const selected = () => rows[table].filter(row => filters.every(([key, value]) => row[key] === value)).sort((a, b) => (Number(a.priority ?? 0) - Number(b.priority ?? 0)) * (order === "desc" ? -1 : 1));
      const builder = { withIndex: (_name: string, filter: (q: unknown) => unknown) => { const q = { eq: (key: string, value: unknown) => { filters.push([key, value]); return q; } }; filter(q); return builder; }, first: async () => selected()[0] ?? null,
        order: (direction: string) => { order = direction; return builder; }, take: async (limit: number) => { limits.push(limit); return selected().slice(0, limit); } };
      return builder;
    },
    insert: async (table: string, value: Record<string, unknown>) => { rows[table].push({ _id: `row${rows[table].length}`, ...value }); },
    patch: async (id: string, value: Record<string, unknown>) => { Object.assign(rows.pageVisitStats.find(row => row._id === id)!, value); },
  } };
  return { ctx, rows, limits };
}

test("Convex handlers keep ranking writes site-local, coalesce reloads and exclude deletions", async () => {
  const saved = process.env.WIKI_PREFETCH_SECRET;
  const secret = "synthetic-prefetch-test-key-00000000000000";
  process.env.WIKI_PREFETCH_SECRET = secret;
  try {
    const { ctx, rows, limits } = database();
    const record = (recordVisit as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<void> })._handler;
    const read = (priorities as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
    const args = { siteSlug: "alpha", serverSecret: secret, slug: "shared" };
    await expect(record(ctx, { ...args, serverSecret: "invalid" })).rejects.toThrow("Unauthorized");
    expect(rows.pageVisitStats).toHaveLength(0);
    await record(ctx, args);
    const priority = rows.pageVisitStats[0].priority;
    await record(ctx, args);
    expect(rows.pageVisitStats).toHaveLength(1);
    expect(rows.pageVisitStats[0].priority).toBe(priority);
    await record(ctx, { ...args, siteSlug: "beta" });
    await record(ctx, { ...args, slug: "deleted" });
    await record(ctx, { ...args, slug: "does-not-exist" });
    expect(rows.pageVisitStats).toHaveLength(2);
    expect(await read(ctx, args)).toEqual([{ slug: "shared", sensitive: false }]);
    rows.documents[0].deletedAt = 1;
    expect(await read(ctx, args)).toEqual([]);
    expect(limits.every(limit => limit === 300)).toBe(true);
    expect(Object.keys(rows.pageVisitStats[0]).sort()).toEqual(["_id", "lastVisitedAt", "priority", "siteId", "slug"]);
  } finally {
    if (saved === undefined) delete process.env.WIKI_PREFETCH_SECRET;
    else process.env.WIKI_PREFETCH_SECRET = saved;
  }
});
