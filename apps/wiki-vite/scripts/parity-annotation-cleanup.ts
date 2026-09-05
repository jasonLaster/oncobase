import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

type Row = { id: string; tableName: string; seriesKey: string; imageKey: string; annotationCount: number };
const ownedKey = /^playwright-parity-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function emptyOwnedRowIds(seriesKey: string, imageKeys: Set<string>, rows: Row[]) {
  if (!ownedKey.test(seriesKey)) throw new Error("Cleanup requires an exact test-owned UUID namespace");
  for (const row of rows) {
    const knownTable = ["imageAnnotations", "dicomImages", "dicomSeries"].includes(row.tableName);
    const ownedImage = row.tableName === "dicomSeries" ? row.imageKey === `4-10 biopsy/${seriesKey}`
      : row.imageKey.startsWith(`${seriesKey}/`) && imageKeys.has(row.imageKey);
    if (!knownTable || row.seriesKey !== seriesKey || !ownedImage || row.annotationCount !== 0 || !row.id) {
      throw new Error("Refusing to delete a nonempty or unowned annotation row");
    }
  }
  return rows.map((row) => row.id);
}

// Test setup/teardown only, never exposed to the browser or app server. This uses the
// dashboard's existing exact-ID deletion; no test-only product API is added.
// Contract: get-convex/convex-backend, npm-packages/system-udfs/convex/
// _system/frontend/deleteDocuments.ts and convex CLI runOneoffQuery.ts.
export function annotationRowCleanup() {
  const url = process.env.PARITY_CONVEX_URL;
  const key = process.env.PARITY_CONVEX_CLEANUP_KEY;
  if (!url || !key) throw new Error("Annotation QA needs PARITY_CONVEX_URL and PARITY_CONVEX_CLEANUP_KEY for complete teardown");
  const client = new ConvexHttpClient(url);
  (client as unknown as { setAdminAuth: (key: string) => void }).setAdminAuth(key);
  async function read(seriesKey: string): Promise<Row[]> {
    if (!ownedKey.test(seriesKey)) throw new Error("Refusing a non-test annotation namespace");
    const source = `import { query } from "convex:/_system/repl/wrappers.js";
      export default query({handler: async (ctx) => {
        const site = await ctx.db.query("sites").withIndex("by_slug", q => q.eq("slug", "diana")).unique();
        if (!site) throw new Error("QA site missing");
        const result = [];
        for (const tableName of ["imageAnnotations", "dicomImages", "dicomSeries"]) {
          const index = tableName === "dicomSeries" ? "by_site_series_key" : "by_site_series";
          const rows = await ctx.db.query(tableName).withIndex(index, q => q.eq("siteId", site._id).eq("seriesKey", ${JSON.stringify(seriesKey)})).collect();
          result.push(...rows.map(row => ({id: row._id, tableName, seriesKey: row.seriesKey,
            imageKey: row.imageKey ?? row.path ?? row.relativeDirectory, annotationCount: row.annotations?.length ?? 0})));
        }
        return result;
      }});`;
    const response = await fetch(new URL("/api/run_test_function", url), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminKey: key, args: {}, bundle: { path: "testQuery.js", source }, format: "convex_encoded_json" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Cleanup inventory failed: HTTP ${response.status}`);
    const result = await response.json();
    if (result.status !== "success" || !Array.isArray(result.value)) throw new Error("Cleanup inventory unavailable");
    return result.value;
  }
  return {
    read,
    async seed(seriesKey: string, sourceImagePath: string) {
      if ((await read(seriesKey)).length) throw new Error("Test namespace already exists");
      const source = await client.query(makeFunctionReference<"query">("dicom:getImageByPath"), {
        siteSlug: "diana", path: sourceImagePath,
      });
      if (!source?.blobUrl || source.deletedAt) throw new Error("Published source image unavailable");
      const imageKey = `${seriesKey}/fixture.dcm`;
      await client.mutation(makeFunctionReference<"mutation">("dicom:upsertSeriesWithImages"), {
        siteSlug: "diana",
        series: { seriesKey, label: "QA annotation fixture (temporary)", relativeDirectory: `4-10 biopsy/${seriesKey}`, modality: "US", studyDate: "2026-04-10" },
        images: [{ path: imageKey, fileName: "fixture.dcm", blobUrl: source.blobUrl,
          sizeBytes: source.sizeBytes, rows: source.rows, columns: source.columns, pixelSpacing: source.pixelSpacing,
          instanceNumber: 1 }],
      });
      return imageKey;
    },
    async removeEmpty(seriesKey: string, imageKeys: Set<string>, expectedRows: number) {
      const rows = await read(seriesKey);
      if (rows.filter((row) => row.tableName === "imageAnnotations").length !== expectedRows) throw new Error("App and cleanup backend disagree; refusing deletion");
      const ids = emptyOwnedRowIds(seriesKey, imageKeys, rows);
      if (ids.length) {
        const result = await client.mutation(makeFunctionReference<"mutation">("_system/frontend/deleteDocuments:default"), {
          toDelete: rows.map(({ id, tableName }) => ({ id, tableName })),
        });
        if (result.success !== true) throw new Error("Annotation row deletion failed");
      }
      if ((await read(seriesKey)).length) throw new Error("Annotation rows remain after deletion");
      return ids;
    },
  };
}
