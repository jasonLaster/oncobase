import crypto from "node:crypto";
import { expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { handlePublishRequest } from "./publish-api";

function fixture() {
  const mutations: Array<{ name: string; args: any; options?: any }> = [];
  const queries: string[] = [];
  let status: any = { revision: 1, snapshot: null };
  const visibleAssets = new Map<string, any>();
  const client = {
    async query(ref: any, args: any) {
      const name = getFunctionName(ref);
      queries.push(name);
      if (name === "sites:getBySlug") return { publishTokenHash: `sha256:${crypto.createHash("sha256").update("fixture").digest("hex")}`, config: {} };
      if (name === "sites:publisherStatus") return status;
      if (name === "documents:getPdfAssetByPath" || name === "documents:getFileAssetByPath") return visibleAssets.get(args.path) ?? null;
      if (name !== "documents:publisherState") throw new Error("Unexpected unscoped inventory read");
      return { version: 1,
        documents: args.slugs.map((slug: string) => ({ slug, exists: true, contentHash: "same", observedHash: slug === "corrupt" ? "corrupted" : "same", hashFunctionVersion: 1, sensitive: false })),
        assets: args.assets.map((asset: any) => ({ ...asset, exists: true, contentHash: asset.path === "unknown.png" ? null : "same", visibilityHash: "stale", observedVisibilityHash: "different", hasVisibility: true, hasBlob: true })),
      };
    },
    async mutation(ref: any, args: any, options?: any) {
      mutations.push({ name: getFunctionName(ref), args, options });
      if (getFunctionName(ref) === "documents:importVersions") return { found: true, inserted: args.versions.length, skipped: 0 };
    },
  };
  const request = (step: string, body: any, token = "fixture") => handlePublishRequest({ step, client: client as never,
    request: new Request(`http://localhost/api/publish/${step}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Publisher-Version": "1" }, body: JSON.stringify({ siteSlug: "alpha", ...body }) }),
  });
  return { mutations, queries, request, visibleAssets, setStatus: (value: any) => { status = value; } };
}

test("scoped dry-run reads only selected rows, detects corrupt content/visibility, and never locks or tombstones", async () => {
  const f = fixture();
  const res = await f.request("scoped/begin", { dryRun: true, manifest: {
    documents: [{ slug: "valid", hash: "same" }, { slug: "corrupt", hash: "same" }],
    assets: [{ path: "shared.png", kind: "file", hash: "same", visibilityHash: "stale" }, { path: "unknown.png", kind: "file", hash: "same", visibilityHash: "stale" }],
  } });
  expect(res.status).toBe(200);
  const plan = await res.json();
  expect(plan.scoped).toBe(true);
  expect(plan.missingDocumentSlugs).toEqual(["corrupt"]);
  expect(plan.assetChanges[0].reason).toBe("metadataMismatch");
  expect(plan.assetChanges[1].reason).toBe("unverifiedRemoteBytes");
  expect(plan.staleDocumentSlugs).toEqual([]);
  expect(plan.staleAssetPaths).toEqual([]);
  expect(f.mutations).toEqual([]);
  expect(f.queries).toEqual(["sites:getBySlug", "documents:publisherState"]);
});

test("state and scoped planning reject invalid input or tokens before any writes", async () => {
  const f = fixture();
  expect((await f.request("state", { slugs: [], assets: [] }, "wrong")).status).toBe(401);
  expect((await f.request("state", { slugs: Array(17).fill("doc"), assets: [] })).status).toBe(400);
  expect((await f.request("scoped/begin", { manifest: { documents: [{}], assets: [] } })).status).toBe(400);
  expect(f.queries.filter(q => q === "documents:publisherState")).toEqual([]);
  expect(f.mutations).toEqual([]);
});

test("asset registration forwards ownership and visibility metadata", async () => {
  const f = fixture();
  const visibility = { ownerSlugs: ["private"], sensitive: true, sensitiveInclude: ["team"], visibilityHash: "v1" };
  const res = await f.request("asset", { assetPath: "shared.png", kind: "file", contentHash: "same",
    blobUrl: "https://example.test/sites/alpha/files/shared.png", sizeBytes: 12, ...visibility });
  expect(res.status).toBe(200);
  expect(f.mutations[0].name).toBe("documents:upsertFileAsset");
  expect(f.mutations[0].args).toMatchObject(visibility);
  expect(f.mutations[0].options.skipQueue).toBe(false);
});

test("reader readiness checks actual snapshot bytes and refuses a public sensitive record", async () => {
  const f = fixture();
  const core = { schemaVersion: 1, siteSlug: "alpha", scope: "public", compactTree: [],
    pages: [{ slug: "public", title: "Public", tags: [], description: null, sensitive: false, size: 10, contentHash: "expected" }], assets: [] };
  const manifest = () => ({ ...core, manifestHash: crypto.createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 24), generatedAt: new Date().toISOString() });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json(manifest()) });
  const body = { minimumRevision: 2, documents: [{ slug: "public", hash: "expected", sensitive: false }, { slug: "private", hash: "private-hash", sensitive: true }], assets: [] };
  try {
    expect((await (await f.request("status", body)).json()).ready).toBe(false);
    f.setStatus({ revision: 2, snapshot: { url: `http://127.0.0.1:${server.port}/snapshot`, hash: manifest().manifestHash } });
    const ready = await f.request("status", body);
    expect(ready.status).toBe(200);
    expect((await ready.json()).ready).toBe(true);
    core.pages.push({ slug: "private", title: "Private", tags: [], description: null, sensitive: true, size: 10, contentHash: "private-hash" });
    f.setStatus({ revision: 2, snapshot: { url: `http://127.0.0.1:${server.port}/snapshot`, hash: manifest().manifestHash } });
    const leaked = await (await f.request("status", body)).json();
    expect(leaked.ready).toBe(false);
    expect(leaked.documentMismatches).toBe(1);
    expect(f.mutations).toEqual([]);
  } finally { server.stop(true); }
});

test("scoped asset registration requires the content-based path", async () => {
  const f = fixture();
  const body = { runId: "scoped:11111111-1111-1111-1111-111111111111", assetPath: "shared.png", kind: "file", contentHash: "a".repeat(16), sizeBytes: 12 };
  expect((await f.request("asset", { ...body, blobUrl: "https://example.test/sites/alpha/files/shared.png" })).status).toBe(400);
  expect(f.mutations).toEqual([]);
  expect((await f.request("asset", { ...body, blobUrl: `https://example.test/sites/alpha/files/${body.contentHash}/shared.png` })).status).toBe(200);
});

test("single-cell asset registration requires a sensitive owner and a private Blob URL", async () => {
  const f = fixture();
  const assetPath = "sources/diagnostics/single-cell/manifest.json";
  const body = { siteSlug: "diana", assetPath, contentHash: "same", sizeBytes: 12,
    ownerSlugs: ["sources/diagnostics/single-cell/index"], sensitive: true };
  const suffix = `/sites/diana/files/${assetPath}`;
  const privateUrl = `https://store42.private.blob.vercel-storage.com${suffix}`;
  const publicUrl = `https://store42.public.blob.vercel-storage.com${suffix}`;
  expect((await f.request("asset", { ...body, blobUrl: publicUrl })).status).toBe(400);
  expect((await f.request("asset", { ...body, blobUrl: privateUrl, sensitive: false })).status).toBe(400);
  expect(f.mutations).toEqual([]);
  expect((await f.request("asset", { ...body, blobUrl: privateUrl })).status).toBe(200);
});

test("scoped document hashes are checked before writing", async () => {
  const f = fixture();
  const body = { runId: "scoped:11111111-1111-1111-1111-111111111111", slug: "doc", title: "Title", content: "Source", tags: [], sensitive: false, sensitiveInclude: [], hashFunctionVersion: 3 };
  const hash = crypto.createHash("sha256").update(JSON.stringify({ title: body.title, content: body.content, tags: body.tags, sensitive: body.sensitive, sensitiveInclude: body.sensitiveInclude })).digest("hex").slice(0, 16);
  expect((await f.request("document", { ...body, hash: "incorrect" })).status).toBe(400);
  expect(f.mutations).toEqual([]);
  expect((await f.request("document", { ...body, hash })).status).toBe(200);
  expect(f.mutations[0].args.runId).toBe(body.runId);
  expect(f.mutations[0].args.replaceRawContent).toBe(true);
  expect(f.mutations[0].options.skipQueue).toBe(true);
});


test("reader readiness verifies listed PDFs and images, their manifest hashes, and public asset access", async () => {
  const f = fixture();
  const snapshotWith = (assets: unknown[]) => {
    const core = { schemaVersion: 1, siteSlug: "alpha", scope: "public", compactTree: [], pages: [], assets };
    return { ...core, manifestHash: crypto.createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 24), generatedAt: new Date().toISOString() };
  };
  // A legacy PDF row without a hash, and an image listed with its hash (P11).
  const listed = [
    { kind: "pdf", path: "paper.pdf", contentHash: null, size: null },
    { kind: "file", path: "image.svg", contentHash: "image-hash", size: null },
  ];
  let snapshot = snapshotWith(listed);
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json(snapshot) });
  const publishSnapshot = (next: ReturnType<typeof snapshotWith>) => {
    snapshot = next;
    f.setStatus({ revision: 2, snapshot: { url: `http://127.0.0.1:${server.port}/snapshot`, hash: next.manifestHash } });
  };
  publishSnapshot(snapshot);
  const body = { minimumRevision: 2, documents: [], assets: [
    { path: "paper.pdf", kind: "pdf", hash: "pdf-hash", sensitive: false },
    { path: "image.svg", kind: "file", hash: "image-hash", sensitive: false },
    { path: "private.png", kind: "file", hash: "private-hash", sensitive: true },
    // Data files are not listed in reader manifests; access alone is checked.
    { path: "table.csv", kind: "file", hash: "csv-hash", sensitive: false },
  ] };
  f.visibleAssets.set("paper.pdf", { contentHash: "pdf-hash", blobUrl: "https://fixture/paper" });
  f.visibleAssets.set("image.svg", { contentHash: "image-hash", blobUrl: "https://fixture/image" });
  f.visibleAssets.set("table.csv", { contentHash: "csv-hash", blobUrl: "https://fixture/table" });
  try {
    expect((await (await f.request("status", body)).json()).ready).toBe(true);
    // The manifest still names the previous image bytes: a versioned URL would cache them.
    publishSnapshot(snapshotWith([listed[0], { ...listed[1], contentHash: "old-image-hash" }]));
    expect((await (await f.request("status", body)).json()).assetMismatches).toBe(1);
    // A public image missing from the manifest is not ready either.
    publishSnapshot(snapshotWith([listed[0]]));
    expect((await (await f.request("status", body)).json()).assetMismatches).toBe(1);
    publishSnapshot(snapshotWith(listed));
    f.visibleAssets.set("private.png", { contentHash: "private-hash", blobUrl: "https://fixture/private" });
    expect((await (await f.request("status", body)).json()).assetMismatches).toBe(1);
    f.visibleAssets.delete("private.png");
    f.visibleAssets.get("image.svg").contentHash = "stale";
    expect((await (await f.request("status", body)).json()).ready).toBe(false);
    f.visibleAssets.delete("image.svg");
    expect((await (await f.request("status", body)).json()).ready).toBe(false);
    expect(f.mutations).toEqual([]);
  } finally { server.stop(true); }
});

test("combined completion verifies the entire owned scope and preserves committed-but-unconfirmed status", async () => {
  const runId = "scoped:11111111-1111-1111-1111-111111111111";
  const documents = Array.from({ length: 33 }, (_, i) => ({ slug: `doc-${i}`, hash: "hash", sensitive: false, sensitiveInclude: [] }));
  const assets = [{ path: "shared.pdf", kind: "pdf", hash: "bytes", sensitive: false, visibilityHash: "visibility", sizeBytes: 42 }];
  const calls: string[] = [];
  let corrupt = false, assetCorrupt = false, active = 0, maxActive = 0, readerFails = false;
  const client = {
    async query(ref: any, args: any): Promise<any> {
      const name = getFunctionName(ref); calls.push(name);
      if (name === "sites:getBySlug") return { publishTokenHash: `sha256:${crypto.createHash("sha256").update("fixture").digest("hex")}`,
        publishRunId: runId, publishLockUntil: Date.now() + 60_000, publishScope: { documents: documents.map(d => d.slug), assets: ["pdf:shared.pdf"] }, config: {} };
      if (name === "documents:publisherState") {
        active++; maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 1)); active--;
        return { version: 1, documents: args.slugs.map((slug: string) => ({ slug, exists: true, contentHash: "hash", observedHash: corrupt ? "wrong" : "hash", readerContentConsistent: true, hashFunctionVersion: 3, sensitive: false, sensitiveInclude: [] })),
          assets: args.assets.map((asset: any) => ({ ...asset, exists: true, hasBlob: true, hasVisibility: true, contentHash: "bytes", visibilityHash: "visibility", observedVisibilityHash: assetCorrupt ? "wrong" : "visibility", sizeBytes: 42 })) };
      }
      if (name === "sites:publisherStatus") { if (readerFails) throw Error("Reader unavailable"); return { revision: 7, snapshot: null }; }
      throw Error(`Unexpected ${name}`);
    },
    async mutation(ref: any) { calls.push(getFunctionName(ref)); return { revision: 7 }; },
  };
  const body = { siteSlug: "alpha", runId, verification: "content", hashFunctionVersion: 3, documents, assets };
  const request = (overrides: Record<string, unknown> = {}) => handlePublishRequest({ step: "scoped/complete", client: client as never,
    request: new Request("http://localhost/api/publish/scoped/complete", { method: "POST", headers: { Authorization: "Bearer fixture", "X-Publisher-Version": "1" }, body: JSON.stringify({ ...body, ...overrides }) }) });
  expect((await request({ documents: documents.slice(1) })).status).toBe(409);
  expect((await request({ documents: [...documents.slice(1), documents[1]] })).status).toBe(409);
  expect((await request({ verification: "skip" })).status).toBe(400);
  expect((await request({ runId: "scoped:other" })).status).toBe(409);
  expect(calls).not.toContain("sites:finishPublish");
  corrupt = true;
  expect((await request()).status).toBe(500);
  expect(calls).not.toContain("sites:finishPublish");
  corrupt = false; assetCorrupt = true;
  expect((await request()).status).toBe(500);
  expect(calls).not.toContain("sites:finishPublish");
  assetCorrupt = false;
  const response = await request();
  expect(await response.json()).toEqual({ committed: true, revision: 7, ready: false });
  expect(maxActive).toBe(2);
  expect(calls.filter(c => c === "sites:finishPublish")).toHaveLength(1);
  readerFails = true;
  expect(await (await request()).json()).toEqual({ committed: true, revision: 7, ready: false });
  expect(calls).not.toContain("sites:failPublish");
});

test("malformed JSON and non-object bodies are 400s, not 500s", async () => {
  const f = fixture();
  const raw = (step: string, body: string) => handlePublishRequest({ step, client: {} as never,
    request: new Request(`http://localhost/api/publish/${step}`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fixture", "X-Publisher-Version": "1" }, body }),
  });
  for (const step of ["begin", "finish", "asset", "asset-hashes", "document-hashes"]) {
    for (const body of ["{not json", "", "null", "[]", "42"]) {
      expect((await raw(step, body)).status).toBe(400);
    }
  }
  expect(f.mutations).toEqual([]);
});

test("finish rejects non-string deletion lists before any write", async () => {
  for (const body of [{ deletedDocSlugs: "doc" }, { deletedDocSlugs: ["doc", 1] }, { deletedAssetPaths: [{ path: "a.png" }] }]) {
    const f = fixture();
    const response = await f.request("finish", body);
    expect(response.status).toBe(400);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("arrays of strings");
    expect(f.mutations).toEqual([]);
  }
  const valid = fixture();
  await valid.request("finish", { deletedDocSlugs: ["gone"], deletedAssetPaths: [] });
  expect(valid.mutations.map(m => m.name).slice(0, 2)).toEqual(["documents:deleteBySlug", "sites:finishPublish"]);
});

test("history import validates versions and forwards them to Convex", async () => {
  const f = fixture();
  const version = { title: "Page", content: "old body", tags: ["a"], sensitive: false, versionAt: 1_700_000_000_000, commitSha: "a".repeat(40), commitMessage: "edit" };
  for (const versions of [undefined, [{ ...version, versionAt: "yesterday" }], [{ ...version, commitSha: "not-a-sha" }], Array(201).fill(version)]) {
    expect((await f.request("versions", { slug: "page", versions })).status).toBe(400);
  }
  expect((await f.request("versions", { slug: "page", versions: [version] }, "wrong")).status).toBe(401);
  expect(f.mutations).toEqual([]);
  const imported = await f.request("versions", { slug: "page", versions: [{ ...version, extra: "dropped" }] });
  expect(await imported.json()).toEqual({ found: true, inserted: 1, skipped: 0 });
  expect(f.mutations).toEqual([{ name: "documents:importVersions", args: { siteSlug: "alpha", slug: "page", versions: [version] }, options: undefined }]);
});
