/** Read-only publisher benchmark. Real HTTP requests are restricted to state
 * and dry-run scoped planning; document/asset/finish/lock calls are impossible.
 * Fixture mode measures local scanning plus a simulated server, not production. */
import fs from "node:fs";
import type { DependencyCacheMode } from "../../../packages/oncobase/src/dependency-cache";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { loadConfig, loadPublishToken } from "../../../packages/oncobase/src/config";
import { readPublishScope, readPublishSelection } from "../../../packages/oncobase/src/publish-scope";
import { installPublishProfile } from "../../../packages/oncobase/src/publish-profile";
import { publisherPost } from "../../../packages/oncobase/src/publish-post";
import { readPublishedState, comparePublishedState, type PublishedState } from "../../../packages/oncobase/src/publish-state";
import { hashDocument, HASH_FUNCTION_VERSION } from "../../../packages/oncobase/src/walk-vault";

const { values } = parseArgs({ options: {
  site: { type: "string" }, vault: { type: "string" }, "files-from": { type: "string" },
  profile: { type: "string" }, output: { type: "string" },
  cache: { type: "string", default: "content" },
  scenario: { type: "string", default: "documents" },
  transport: { type: "string", default: "http" }, repeat: { type: "string", default: "3" },
  "fixture-latency-ms": { type: "string", default: "0" },
  "budget-ms": { type: "string", default: "20000" },
} });
if (!values.site || !values["files-from"] || !values.profile || !values.output) {
  throw new Error("Usage: bun apps/app/scripts/benchmark-local-publish.ts --site <site> --files-from <paths.json> --profile <new.json> --output <new.json> [--scenario no-op|documents|mixed|large] [--transport http|fixture] [--repeat 3] [--vault <path>] [--budget-ms 20000]");
}
if (!["content", "metadata", "off", "refresh"].includes(values.cache)) throw new Error("Invalid cache policy");
if (!["no-op", "documents", "mixed", "large"].includes(values.scenario)) throw new Error("Unknown benchmark scenario");
if (!["http", "fixture"].includes(values.transport)) throw new Error("Unknown benchmark transport");
const repeat = Number(values.repeat), budgetMs = Number(values["budget-ms"]), latencyMs = Number(values["fixture-latency-ms"]);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20 || !Number.isFinite(budgetMs) || budgetMs <= 0 ||
    !Number.isInteger(latencyMs) || latencyMs < 0 || latencyMs > 5000) throw new Error("Invalid repeat, budget, or fixture latency");
if (values.transport === "http" && latencyMs) throw new Error("Fixture latency cannot be used with HTTP");
// Refuse accidental replacement before spending time on scans/network.
for (const file of [values.profile, values.output]) if (fs.existsSync(file)) throw new Error("Choose new benchmark output paths");
const profile = installPublishProfile(values.profile);
const config = profile.sync("config", () => loadConfig(values.site!));
const scope = readPublishScope(values["files-from"]);
const assetMode = values.scenario === "mixed" ? "referenced" : "none";
const samples: Array<Record<string, unknown> & { durationMs: number }> = [];

for (let run = 0; run < repeat; run++) {
  const started = performance.now();
  const { documents, assets } = readPublishSelection(values.vault ?? config.vaultPath, scope, assetMode, values.cache as DependencyCacheMode);
  if (values.scenario === "large" && documents.length < 100) throw new Error("The large scenario requires at least 100 selected documents");
  if (values.scenario === "mixed" && !assets.length) throw new Error("The mixed scenario requires referenced assets");
  if (documents.length > 1000 || assets.length > 1024) throw new Error("Narrow the benchmark scope to 1000 documents / 1024 assets");
  const scanMs = performance.now() - started;
  // Simulate changed inputs only in memory. No content or asset bytes are sent.
  const candidates = values.scenario === "no-op" ? documents : documents.map(doc => {
    const changed = { ...doc, content: `${doc.content}\nBenchmark-only change` };
    return { ...changed, hash: hashDocument(changed) };
  });
  const candidateAssets = values.scenario === "mixed" ? assets.map(asset => ({ ...asset,
    hash: createHash("sha256").update(`${asset.hash}:benchmark-only-change`).digest("hex").slice(0, 16),
  })) : assets;
  const fixtureState: PublishedState = { version: 1,
    documents: documents.map(doc => ({ slug: doc.slug, exists: true, contentHash: doc.hash, observedHash: doc.hash, readerContentConsistent: true,
      hashFunctionVersion: HASH_FUNCTION_VERSION, sensitive: doc.sensitive, sensitiveInclude: doc.sensitiveInclude })),
    assets: assets.map(asset => ({ path: asset.relativePath, kind: asset.kind, exists: true, contentHash: asset.hash,
      visibilityHash: asset.visibilityHash, observedVisibilityHash: asset.visibilityHash, hasVisibility: true, hasBlob: true, sizeBytes: asset.sizeBytes })),
  };
  const fixtureHashes = new Map(fixtureState.documents.map(doc => [doc.slug, doc.contentHash]));
  const fixtureAssetHashes = new Map(fixtureState.assets.map(asset => [`${asset.kind}:${asset.path}`, asset.contentHash]));
  const fixture = values.transport === "fixture" ? Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    if (latencyMs) await Bun.sleep(latencyMs);
    const body = await request.json();
    const route = new URL(request.url).pathname;
    if (request.method !== "POST") return new Response("Read-only benchmark", { status: 405 });
    if (route === "/api/publish/state") {
      const requestedSlugs = new Set<string>(body.slugs);
      const requestedAssets = new Set(body.assets.map((asset: { path: string; kind: string }) => `${asset.kind}:${asset.path}`));
      return Response.json({ version: 1,
        documents: fixtureState.documents.filter(doc => requestedSlugs.has(doc.slug)),
        assets: fixtureState.assets.filter(asset => requestedAssets.has(`${asset.kind}:${asset.path}`)),
      });
    }
    if (route !== "/api/publish/scoped/begin" || body.dryRun !== true) return new Response("Read-only benchmark", { status: 403 });
    return Response.json({ scoped: true,
      missingDocumentSlugs: candidates.filter(doc => fixtureHashes.get(doc.slug) !== doc.hash).map(doc => doc.slug),
      missingAssetPaths: candidateAssets.filter(asset => fixtureAssetHashes.get(`${asset.kind}:${asset.relativePath}`) !== asset.hash).map(asset => asset.relativePath), staleDocumentSlugs: [], staleAssetPaths: [],
    });
  } }) : undefined;
  const publishUrl = fixture ? `http://127.0.0.1:${fixture.port}/api/publish` : config.publishUrl;
  const token = fixture ? "fixture-only" : loadPublishToken(config.site);
  try {
    const planStart = performance.now();
    const plan = await profile.span("plan", () => publisherPost<{
      scoped: boolean; missingDocumentSlugs: string[]; missingAssetPaths: string[];
      staleDocumentSlugs: string[]; staleAssetPaths: string[];
    }>(`${publishUrl}/scoped/begin`, token, {
      siteSlug: config.site, dryRun: true, hashFunctionVersion: HASH_FUNCTION_VERSION,
      manifest: { documents: candidates.map(({ slug, hash, sensitive }) => ({ slug, hash, sensitive })),
        assets: candidateAssets.map(asset => ({ path: asset.relativePath, kind: asset.kind, hash: asset.hash, visibilityHash: asset.visibilityHash })) },
    }, { profile, signal: AbortSignal.timeout(20_000) }));
    const planMs = performance.now() - planStart;
    if (plan.scoped !== true || plan.staleDocumentSlugs.length || plan.staleAssetPaths.length) throw new Error("Server did not acknowledge scoped read-only planning");
    const verifyStart = performance.now();
    const state = await profile.span("verify.documents", () => readPublishedState({ publishUrl, token, site: config.site,
      slugs: documents.map(doc => doc.slug), assets: assets.map(asset => ({ path: asset.relativePath, kind: asset.kind })), profile }));
    const mismatches = comparePublishedState(state, documents, assets);
    const sample = { iteration: run + 1, durationMs: Math.round(performance.now() - started), scanMs: Math.round(scanMs),
      planMs: Math.round(planMs), verifyMs: Math.round(performance.now() - verifyStart),
      documents: documents.length, assets: assets.length, assetBytesHashed: assets.reduce((n, a) => n + a.sizeBytes, 0),
      plannedDocuments: plan.missingDocumentSlugs.length, plannedAssets: plan.missingAssetPaths.length,
      baselineDocumentMismatches: mismatches.documentMismatches.length, baselineAssetMismatches: mismatches.assetMismatches.length,
    };
    samples.push(sample);
    console.log(JSON.stringify(sample));
  } finally { fixture?.stop(true); }
}
const sorted = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
const snapshot = profile.snapshot();
const summary = { mode: "read-only", transport: values.transport, scenario: values.scenario, cache: values.cache, assetMode,
  fixtureLatencyMs: values.transport === "fixture" ? latencyMs : null,
  budgetMs, allWithinBudget: sorted.every(ms => ms <= budgetMs),
  firstMs: samples[0].durationMs, medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1),
  decodedResponseBytes: snapshot.spans.reduce((n, s) => n + (s.metrics.responseBytes ?? 0), 0),
  httpRequests: snapshot.spans.filter(s => s.name === "http.state" || s.name === "http.scoped/begin").length,
  omitted: ["lock acquisition", "writes", "blob uploads", "finish", "embeddings", "post-finish reader visibility"], samples,
};
fs.writeFileSync(values.output, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: "wx" });
console.log(JSON.stringify(summary));
if (!summary.allWithinBudget) process.exitCode = 1;
