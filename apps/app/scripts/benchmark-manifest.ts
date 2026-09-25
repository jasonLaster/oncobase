/** Read-only production shadow experiments. Only aggregate measurements leave
 * this process; synthetic additions are never sent to the application backend. */
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { parse } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { parseWikiManifest, type WikiManifestPage } from "@oncobase/wiki-content";
import { createWikiManifestResponse, type WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import { internal } from "../convex/_generated/api";
import { patchManifestPages } from "../convex/lib/manifestDelta";

const { values } = parseArgs({ options: {
  "env-file": { type: "string" }, backend: { type: "string" }, site: { type: "string" },
  output: { type: "string" }, repeats: { type: "string", default: "3" },
  "batch-sizes": { type: "string", default: "500,1000,2000" },
  variants: { type: "string", default: "full,update-1,update-16,add-1,add-16" },
  "export-axiom": { type: "boolean", default: false }, revision: { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("bun scripts/benchmark-manifest.ts --env-file PATH --backend URL --site SLUG --output PATH [--repeats 3] [--batch-sizes 500,1000,2000] [--variants full,update-1,update-16,add-1,add-16] [--export-axiom] [--revision GIT_SHA]\nRead-only shadow benchmark: blocks backend mutations/actions; checks manifest hash equivalence and stable revisions. Output and Axiom contain aggregate measurements only. No publish/write/install timings are measured.");
  process.exit(0);
}
if (!values["env-file"] || !values.backend || !values.site || !values.output || existsSync(values.output)) throw Error("Provide env-file, backend, site and a new output path");
const config = { ...parse(readFileSync(values["env-file"])), ...process.env };
const repeats = Number(values.repeats), batches = values["batch-sizes"]!.split(",").map(Number);
const variants = values.variants!.split(",");
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5 || !batches.length || batches.length > 4 || batches.some(n => !Number.isInteger(n) || n < 128 || n > 2000) || variants.some(v => !["full", "update-1", "update-16", "add-1", "add-16"].includes(v))) throw Error("Invalid bounded experiment options");
if (!config.CONVEX_DEPLOY_KEY || (values["export-axiom"] && !config.AXIOM_API_KEY)) throw Error("Missing operator/export credentials");
const backend = new URL(values.backend);
if (backend.protocol !== "https:" || !backend.hostname.endsWith(".convex.cloud") || backend.pathname !== "/") throw Error("Use an explicit Convex cloud URL");
const transport = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== backend.origin || url.pathname !== "/api/query") throw Error("Read-only query transport");
  return fetch(input, { ...init, signal: AbortSignal.timeout(20000), redirect: "error" });
}, { preconnect: fetch.preconnect });
const client = new ConvexHttpClient(backend.origin, { fetch: transport, logger: false }) as unknown as {
  setAdminAuth(key: string): void;
  query<Q extends FunctionReference<"query", "internal">>(fn: Q, args: FunctionArgs<Q>): Promise<FunctionReturnType<Q>>;
};
client.setAdminAuth(config.CONVEX_DEPLOY_KEY);
const siteSlug = values.site;
const status = async () => (await client.query(internal.manifestCache.status, { siteSlug }))[0];
const hash = (raw: any) => createHash("sha256").update(JSON.stringify({ schemaVersion: raw.schemaVersion, siteSlug: raw.siteSlug, scope: raw.scope, compactTree: raw.compactTree, pages: raw.pages, assets: raw.assets })).digest("hex").slice(0, 24);
const snapshot = async (state: Awaited<ReturnType<typeof status>>) => {
  if (!state?.url || !state.hash) throw Error("No ready base");
  const response = await fetch(state.url, { signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) throw Error("Snapshot unavailable");
  const raw = await response.json();
  const parsed = parseWikiManifest(raw);
  if (parsed.scope !== "public" || parsed.siteSlug !== siteSlug || hash(raw) !== state.hash || parsed.manifestHash !== state.hash || parsed.pages.some(p => p.sensitive)) throw Error("Invalid base");
  return raw;
};
const build = async (documents: WikiApiDocumentsGateway, phases: Record<string, number>) => {
  const r = await createWikiManifestResponse(new Request("https://benchmark.invalid/api/wiki/manifest?scope=public"), { siteSlug, documents, getSessionUser: async () => null, onManifestPhase: (n, ms) => { phases[n] = ms; } });
  if (!r.ok || r.headers.get("X-Wiki-Manifest-Partial") === "true" || r.headers.get("X-Wiki-Manifest-Source") !== "manifest") throw Error("Incomplete manifest");
  return r.json();
};
const unused = async (): Promise<never> => { throw Error("No fallback in benchmark"); };
const empty = async () => ({ page: [], isDone: true, continueCursor: null });
const gateways = (pages: WikiManifestPage[], assets: any[]): WikiApiDocumentsGateway => ({
  listManifestPage: async () => ({ page: pages, isDone: true, continueCursor: null }),
  listPdfAssetVisibilityPage: async () => ({ page: assets.map(a => ({ path: a.path, ownerSlugs: [], sensitive: false })), isDone: true, continueCursor: null }),
  listFileAssetVisibilityPage: empty, listPageWithContent: unused, listPdfAssetPathsPage: unused, listFileAssetPathsPage: unused, getBySlug: unused,
});
const experimentId = randomBytes(16).toString("hex");
type Sample = { variant: string; iteration: number; startedAt: number; durationMs: number; requests: number; phases: Record<string, number>; equivalent: boolean; stable: boolean; outcome: string; pages: number; assets: number };
const samples: Sample[] = [];
let exported = 0;
async function exportSample(sample: Sample) {
  if (!values["export-axiom"]) return;
  const attributes: Record<string, string | number | boolean> = { "experiment.id": experimentId, "experiment.variant": sample.variant, "experiment.iteration": sample.iteration, "experiment.read_only": true, "experiment.equivalent": sample.equivalent, "experiment.stable": sample.stable, "experiment.outcome": sample.outcome, "experiment.requests": sample.requests, "experiment.pages": sample.pages, "experiment.assets": sample.assets, "measurement.duration_ms": sample.durationMs };
  for (const [key, ms] of Object.entries(sample.phases)) attributes[`experiment.phase.${key}_ms`] = ms;
  const attrs = (obj: Record<string, string | number | boolean>) => Object.entries(obj).map(([key, value]) => ({ key, value: typeof value === "boolean" ? { boolValue: value } : typeof value === "number" ? { doubleValue: value } : { stringValue: value } }));
  const r = await fetch(`${(config.AXIOM_URL || "https://api.axiom.co").replace(/\/$/, "")}/v1/traces`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${config.AXIOM_API_KEY}`, "X-Axiom-Dataset": config.AXIOM_DATASET || "oncobase-traces", "Content-Type": "application/json" }, body: JSON.stringify({ resourceSpans: [{ resource: { attributes: attrs({ "service.name": "oncobase-experiments", "service.version": values.revision || "working-tree", "deployment.environment.name": "production-read-only" }) }, scopeSpans: [{ scope: { name: "oncobase.manifest-experiments" }, spans: [{ name: "experiment.manifest", traceId: experimentId, spanId: randomBytes(8).toString("hex"), kind: 1, startTimeUnixNano: String(BigInt(sample.startedAt) * 1000000n), endTimeUnixNano: String(BigInt(sample.startedAt) * 1000000n + BigInt(Math.round(sample.durationMs * 1e6))), attributes: attrs(attributes), status: { code: sample.outcome === "passed" ? 1 : 2 } }] }] }] }) });
  if (!r.ok) throw Error(`Axiom export HTTP ${r.status}`);
  const result = await r.json();
  if (Number(result.partialSuccess?.rejectedSpans ?? 0) > 0) throw Error("Axiom rejected spans");
  exported++;
}
let setupStage = "status";
try {
  const initial = await status();
  setupStage = "snapshot";
  const seed = await snapshot(initial);
  setupStage = "trials";
  const cases = variants.flatMap(v => v === "full" ? batches.map(b => `full-${b}`) : [v]);
  for (let iteration = 1; iteration <= repeats; iteration++) {
    // Rotate order to avoid always giving one variant the warmest caches.
    const order = [...cases.slice((iteration - 1) % cases.length), ...cases.slice(0, (iteration - 1) % cases.length)];
    for (const variant of order) {
      const sample: Sample = { variant, iteration, startedAt: Date.now(), durationMs: 0, requests: 0, phases: {}, equivalent: false, stable: false, outcome: "failed", pages: seed.pages.length, assets: seed.assets.length };
      const started = performance.now();
      try {
        const before = await status();
        sample.requests++;
        let result: any, expected: string;
        if (variant.startsWith("full-")) {
          const batchSize = Number(variant.slice(5));
          const docs: WikiApiDocumentsGateway = { ...gateways([], []),
            listManifestPage: args => { sample.requests++; return client.query(internal.documents.internal_listManifestPage, { ...args, numItems: batchSize, siteSlug }); },
            listPdfAssetVisibilityPage: args => { sample.requests++; return client.query(internal.documents.internal_listPdfAssetVisibilityPage, { ...args, siteSlug }); },
          };
          result = await build(docs, sample.phases);
          expected = before.hash!;
        } else {
          const downloadStart = performance.now();
          const base = await snapshot(before); sample.requests++;
          sample.phases.snapshot = performance.now() - downloadStart;
          const count = Number(variant.split("-")[1]);
          const slugs = Array.from({ length: count }, (_, i) => base.pages[Math.floor(i * base.pages.length / count)].slug as string);
          const readStart = performance.now();
          const updates = await client.query(internal.documents.internal_publisherManifestPages, { siteSlug, slugs }); sample.requests++;
          sample.phases.lookup = performance.now() - readStart;
          for (let i = 0; i < updates.length; i++) {
            if (!updates[i]) throw Error("Missing selected page");
            updates[i] = variant.startsWith("add-")
              ? { ...updates[i]!, slug: `benchmark-synthetic-${experimentId}/${i}` }
              : { ...updates[i]!, title: "Benchmark synthetic update", contentHash: "benchmark-changed" };
          }
          const patchStart = performance.now();
          const patched = patchManifestPages(base, siteSlug, before.hash!, updates);
          sample.phases.patch = performance.now() - patchStart;
          if (!patched) throw Error("Unsupported delta");
          result = JSON.parse(patched);
          // Independent full builder oracle, outside the measured operation.
          sample.durationMs = performance.now() - started;
          const replacements = new Map(updates.map(p => [p!.slug, p!]));
          const oraclePages = base.pages.map((p: WikiManifestPage) => replacements.get(p.slug) ?? p);
          if (variant.startsWith("add-")) oraclePages.push(...updates);
          expected = (await build(gateways(oraclePages, base.assets), {})).manifestHash;
        }
        if (!sample.durationMs) sample.durationMs = performance.now() - started;
        sample.equivalent = result.manifestHash === expected && hash(result) === expected;
        const after = await status();
        sample.stable = before.revision === after.revision && before.hash === after.hash;
        sample.outcome = sample.equivalent && sample.stable ? "passed" : "invalid";
      } catch { sample.durationMs ||= performance.now() - started; }
      samples.push(sample);
      writeFileSync(values.output!, JSON.stringify({ experimentId, exported, samples }, null, 2) + "\n", { mode: 0o600 });
      await exportSample(sample);
      console.log(JSON.stringify({ experimentId, ...sample }));
    }
  }
  writeFileSync(values.output, JSON.stringify({ experimentId, exported, samples }, null, 2) + "\n", { mode: 0o600 });
  if (samples.some(s => s.outcome !== "passed")) process.exitCode = 1;
} catch {
  console.error(`Experiment stage: ${setupStage}`);
  console.error("Experiment stopped; retained aggregate samples. No backend error bodies or credentials were logged.");
  process.exitCode = 1;
}
