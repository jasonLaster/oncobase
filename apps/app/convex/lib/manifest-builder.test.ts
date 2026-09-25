import { expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { createHash } from "node:crypto";
import { build } from "../manifestBuilder";

const handler = (build as unknown as { _handler: (ctx: any, args: any) => Promise<null> })._handler;

test("scheduled public additions use the delta and forward ownership to installation", async () => {
  const core = { schemaVersion: 1, siteSlug: "alpha", scope: "public", compactTree: [], pages: [], assets: [] };
  const hash = createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 24);
  const base = { ...core, manifestHash: hash, generatedAt: "fixture" };
  const queries: string[] = [], mutations: any[] = [];
  let stored: any;
  const savedOrigin = process.env.WIKI_TELEMETRY_ORIGIN;
  delete process.env.WIKI_TELEMETRY_ORIGIN;
  try {
    await handler({
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
    expect(mutations).toEqual([{ name: "manifestCache:install", siteSlug: "alpha", revision: 1, hash: stored.manifestHash, storageId: "new-blob", formatVersion: 1, generation: 7 }]);
  } finally {
    if (savedOrigin !== undefined) process.env.WIKI_TELEMETRY_ORIGIN = savedOrigin;
  }
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
