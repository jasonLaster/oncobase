import { expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { createHash } from "node:crypto";
import { build as fullBuild } from "../manifestBuilder";
import { build as deltaBuild } from "../manifestDeltaBuilder";
import { MANIFEST_SNAPSHOT_VERSION } from "./manifestRevision";

type Handler = (ctx: any, args: any) => Promise<null>;
const handler = (fullBuild as unknown as { _handler: Handler })._handler;
const deltaHandler = (deltaBuild as unknown as { _handler: Handler })._handler;
const withoutTelemetry = async (run: () => Promise<unknown>) => {
  const savedOrigin = process.env.WIKI_TELEMETRY_ORIGIN;
  delete process.env.WIKI_TELEMETRY_ORIGIN;
  try { await run(); } finally { if (savedOrigin !== undefined) process.env.WIKI_TELEMETRY_ORIGIN = savedOrigin; }
};

test("scheduled public additions use the delta and forward ownership to installation", async () => {
  const core = { schemaVersion: 1, siteSlug: "alpha", scope: "public", compactTree: [], pages: [], assets: [] };
  const hash = createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 24);
  const base = { ...core, manifestHash: hash, generatedAt: "fixture" };
  const queries: string[] = [], mutations: any[] = [];
  let stored: any;
  const savedOrigin = process.env.WIKI_TELEMETRY_ORIGIN;
  delete process.env.WIKI_TELEMETRY_ORIGIN;
  try {
    await deltaHandler({
      runQuery: async (ref: any) => {
        const name = getFunctionName(ref); queries.push(name);
        if (name === "manifestCache:revision") return 1;
        if (name === "manifestCache:deltaBase") return { storageId: "base", hash };
        if (name === "documents:internal_publisherManifestPages") return [{ slug: "new", title: "New", contentHash: "new", tags: [], description: null, sensitive: false, size: 1 }];
        throw Error("Unexpected full scan");
      },
      storage: { get: async () => new Blob([JSON.stringify(base)]), store: async (blob: Blob) => { stored = JSON.parse(await blob.text()); return "new-blob"; }, delete: async () => {} },
      runMutation: async (ref: any, args: any) => { mutations.push({ name: getFunctionName(ref), ...args }); return "installed"; },
    }, { siteSlug: "alpha", generation: 7, attempt: 1, delta: { baseRevision: 0, slugs: ["new"] } });
    expect(queries).toHaveLength(3);
    expect(stored.pages.map((p: any) => p.slug)).toEqual(["new"]);
    expect(stored.compactTree).toEqual([["f", "new"]]);
    expect(mutations).toEqual([{ name: "manifestCache:install", siteSlug: "alpha", revision: 1, hash: stored.manifestHash, storageId: "new-blob", formatVersion: MANIFEST_SNAPSHOT_VERSION, generation: 7 }]);
  } finally {
    if (savedOrigin !== undefined) process.env.WIKI_TELEMETRY_ORIGIN = savedOrigin;
  }
});

test("an asset-only delta reads the changed asset rows, never the full listing", async () => {
  const core = { schemaVersion: 1, siteSlug: "alpha", scope: "public", compactTree: [], pages: [], assets: [] };
  const hash = createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 24);
  const base = { ...core, manifestHash: hash, generatedAt: "fixture" };
  const queries: Array<{ name: string; args: any }> = [];
  let stored: any;
  await withoutTelemetry(() => deltaHandler({
    runQuery: async (ref: any, args: any) => {
      const name = getFunctionName(ref); queries.push({ name, args });
      if (name === "manifestCache:revision") return 1;
      if (name === "manifestCache:deltaBase") return { storageId: "base", hash };
      if (name === "documents:internal_publisherManifestAssets") return [{ kind: "pdf", path: "a.pdf", listed: true, contentHash: "pa" }];
      throw Error("Unexpected full scan");
    },
    storage: { get: async () => new Blob([JSON.stringify(base)]), store: async (blob: Blob) => { stored = JSON.parse(await blob.text()); return "new-blob"; }, delete: async () => {} },
    runMutation: async () => "installed",
  }, { siteSlug: "alpha", delta: { baseRevision: 0, slugs: [], assets: ["pdf:a.pdf"] } }));
  expect(queries.map(query => query.name)).toEqual(["manifestCache:revision", "manifestCache:deltaBase", "documents:internal_publisherManifestAssets"]);
  expect(queries[2].args).toEqual({ siteSlug: "alpha", keys: ["pdf:a.pdf"] });
  expect(stored.assets).toEqual([{ kind: "pdf", path: "a.pdf", contentHash: "pa", size: null }]);
  expect(stored.compactTree).toEqual([["p", "a"]]);
});

test("a failed install and failed blob cleanup still reach durable retry handling", async () => {
  const mutations: any[] = [];
  const savedOrigin = process.env.WIKI_TELEMETRY_ORIGIN;
  delete process.env.WIKI_TELEMETRY_ORIGIN;
  try {
    await handler({
      runQuery: async (ref: any) => {
        const name = getFunctionName(ref);
        if (name === "manifestCache:revision") return 2;
        if (name === "documents:internal_listManifestPage" || name === "documents:internal_listPdfAssetVisibilityPage") return { page: [], isDone: true, continueCursor: null };
        throw Error("Unexpected query");
      },
      storage: { store: async () => "orphan", delete: async () => { throw Error("Storage unavailable"); } },
      runMutation: async (ref: any, args: any) => {
        const name = getFunctionName(ref);
        if (name === "manifestCache:install") throw Error("Install unavailable");
        mutations.push({ name, ...args }); return null;
      },
    }, { siteSlug: "alpha", generation: 8, attempt: 1, clientTraceId: "a".repeat(32) });
    expect(mutations).toEqual([{ name: "manifestCache:failed", siteSlug: "alpha", generation: 8, attempt: 1, clientTraceId: "a".repeat(32), delta: undefined }]);
  } finally {
    if (savedOrigin !== undefined) process.env.WIKI_TELEMETRY_ORIGIN = savedOrigin;
  }
});

test("a delta that cannot be patched hands off to the Node full builder under the same ownership", async () => {
  for (const scenario of ["base-unavailable", "full-required"] as const) {
    const scheduled: any[] = [], mutations: any[] = [];
    await withoutTelemetry(() => deltaHandler({
      runQuery: async (ref: any) => {
        const name = getFunctionName(ref);
        if (name === "manifestCache:revision") return scenario === "full-required" ? 5 : 1;
        if (name === "manifestCache:deltaBase") return null;
        if (name === "documents:internal_publisherManifestPages") return [];
        throw Error(`Unexpected query ${name}`);
      },
      storage: { get: async () => { throw Error("No base to read"); }, store: async () => { throw Error("Delta must not store"); } },
      runMutation: async (ref: any, args: any) => { mutations.push({ name: getFunctionName(ref), ...args }); return null; },
      scheduler: { runAfter: async (delay: number, ref: any, args: any) => { scheduled.push({ delay, name: getFunctionName(ref), ...args }); } },
    }, { siteSlug: "alpha", queuedAt: 10, generation: 9, attempt: 0, clientTraceId: "b".repeat(32), delta: { baseRevision: 0, slugs: ["page"] } }));
    expect(mutations).toEqual([]);
    expect(scheduled).toHaveLength(1);
    const { fallback, ...job } = scheduled[0];
    // Same queue lease and generation, no delta: the full build owns installation.
    expect(job).toEqual({ delay: 0, name: "manifestBuilder:build", siteSlug: "alpha", queuedAt: 10, generation: 9, attempt: 0, clientTraceId: "b".repeat(32) });
    expect(fallback.reason).toBe(scenario);
    if (scenario === "base-unavailable") expect(typeof fallback.deltaReadMs).toBe("number");
    else expect(fallback.deltaReadMs).toBeUndefined();
  }
});

test("the full builder ignores a legacy delta and records the fallback reason", async () => {
  const queries: string[] = [], logged: any[] = [];
  const info = console.info;
  console.info = (_label: string, json: string) => { logged.push(JSON.parse(json)); };
  try {
    await withoutTelemetry(() => handler({
      runQuery: async (ref: any) => {
        const name = getFunctionName(ref); queries.push(name);
        if (name === "manifestCache:revision") return 2;
        if (name === "documents:internal_listManifestPage" || name === "documents:internal_listPdfAssetVisibilityPage" || name === "documents:internal_listFileAssetVisibilityPage") return { page: [], isDone: true, continueCursor: null };
        throw Error(`Unexpected query ${name}`);
      },
      storage: { store: async () => "full-blob", delete: async () => {} },
      runMutation: async () => "installed",
    }, { siteSlug: "alpha", generation: 3, delta: { baseRevision: 1, slugs: ["page"] }, fallback: { reason: "unsupported-pages", deltaReadMs: 12 } }));
  } finally { console.info = info; }
  expect(queries).not.toContain("manifestCache:deltaBase");
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({ incremental: false, strategyReason: "unsupported-pages", outcome: "installed", succeeded: true, phases: { deltaRead: 12 } });
});
