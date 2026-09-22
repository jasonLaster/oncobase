import crypto from "node:crypto";
import { expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { handlePublishRequest } from "./publish-api";

function fixture() {
  const mutations: Array<{ name: string; args: any }> = [];
  const queries: string[] = [];
  let status: any = { revision: 1, snapshot: null };
  const client = {
    async query(ref: any, args: any) {
      const name = getFunctionName(ref);
      queries.push(name);
      if (name === "sites:getBySlug") return { publishTokenHash: `sha256:${crypto.createHash("sha256").update("fixture").digest("hex")}`, config: {} };
      if (name === "sites:publisherStatus") return status;
      if (name !== "documents:publisherState") throw new Error("Unexpected unscoped inventory read");
      return { version: 1,
        documents: args.slugs.map((slug: string) => ({ slug, exists: true, contentHash: "same", observedHash: slug === "corrupt" ? "corrupted" : "same", hashFunctionVersion: 1, sensitive: false })),
        assets: args.assets.map((asset: any) => ({ ...asset, exists: true, contentHash: asset.path === "unknown.png" ? null : "same", visibilityHash: "stale", observedVisibilityHash: "different", hasVisibility: true, hasBlob: true })),
      };
    },
    async mutation(ref: any, args: any) { mutations.push({ name: getFunctionName(ref), args }); },
  };
  const request = (step: string, body: any, token = "fixture") => handlePublishRequest({ step, client: client as never,
    request: new Request(`http://localhost/api/publish/${step}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Publisher-Version": "1" }, body: JSON.stringify({ siteSlug: "alpha", ...body }) }),
  });
  return { mutations, queries, request, setStatus: (value: any) => { status = value; } };
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

test("scoped document hashes are checked before writing", async () => {
  const f = fixture();
  const body = { runId: "scoped:11111111-1111-1111-1111-111111111111", slug: "doc", title: "Title", content: "Source", tags: [], sensitive: false, sensitiveInclude: [], hashFunctionVersion: 3 };
  const hash = crypto.createHash("sha256").update(JSON.stringify({ title: body.title, content: body.content, tags: body.tags, sensitive: body.sensitive, sensitiveInclude: body.sensitiveInclude })).digest("hex").slice(0, 16);
  expect((await f.request("document", { ...body, hash: "incorrect" })).status).toBe(400);
  expect(f.mutations).toEqual([]);
  expect((await f.request("document", { ...body, hash })).status).toBe(200);
  expect(f.mutations[0].args.runId).toBe(body.runId);
  expect(f.mutations[0].args.replaceRawContent).toBe(true);
});
