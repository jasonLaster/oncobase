/** Explicit read-only live profile, using our real OTLP exporter and a local collector. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

type OtlpSpan = { traceId: string; spanId: string; parentSpanId?: string; name: string; startTimeUnixNano: string; endTimeUnixNano: string; attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }>; status?: { code?: number } };
type Sample = { variant: string; scenario: string; run: number; status: number; readyMs: number; completeMs: number; bytes: number; semanticHash: string | null; resultCount: number | null; complete: string | null; responseStartNs: string; responseEndNs: string; traceIds: string[]; rssBytes: number; heapUsedBytes: number };
if (process.argv[2] !== "live") throw new Error("Explicitly select live: profile-backend-matrix.ts live [output-directory] [runs]");
const out = resolve(process.argv[3] ?? ".playwright/backend-matrix/baseline");
const runs = Number(process.argv[4] ?? "3");
const scenarioFilter = process.argv[5] ? new RegExp(process.argv[5]) : null;
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error("Runs must be between 1 and 10");
await mkdir(out, { recursive: true });
const spans: OtlpSpan[] = [];
const collector = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const payload = await request.json();
  for (const resource of payload.resourceSpans ?? []) for (const scope of resource.scopeSpans ?? []) spans.push(...(scope.spans ?? []));
  return Response.json({});
} });
process.env.WIKI_BACKEND_TRACING = "1";
process.env.WIKI_BACKEND_TRACE_SAMPLE_RATE = "1";
process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${collector.port}/v1/traces`;
// Never send locally collected telemetry with ambient collector credentials.
delete process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS;
delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
process.env.NODE_ENV = "development";
const { createClient, createWikiApiHandler, getPasswordGateConfig, authedCookieName } = await import("../server/wiki-api");
const baseline = process.env.WIKI_PROFILE_BASELINE_MODULE ? await import(resolve(process.env.WIKI_PROFILE_BASELINE_MODULE)) : null;
let activeVariant = "candidate";
const { createWikiGateSession } = await import("@oncobase/wiki-content/gate-session");
const { flushBackendTraces } = await import("../server/backend-tracing");
const { api } = await import("../convex/_generated/api");
const client = createClient();
const siteSlug = process.env.WIKI_SITE_SLUG ?? "diana";
process.env.WIKI_SITE_SLUG = siteSlug;
const secret = crypto.randomUUID();
process.env.WIKI_GATE_SESSION_SECRET = secret;
const config = await getPasswordGateConfig(client, siteSlug);
const token = await createWikiGateSession({ siteSlug, secret, gateVersion: JSON.stringify([config.enabled, config.passwordHash ?? (siteSlug === "diana" ? process.env.DIANA_WIKI_PASSWORD_HASH : undefined) ?? "passwordless"]) });
const cookie = `${authedCookieName(siteSlug)}=${token}`;
const samples: Sample[] = [];
let slugs: string[] = [];
let privateSlug: string | undefined;
const manifestPages: Array<{ slug: string; sensitive?: boolean }> = [];
// Discover fixture paths without retaining content or identifiers in artifacts.
let cursor: string | null = null;
while (slugs.length < 100 || !privateSlug) {
  const result: { page: Array<{ slug: string; sensitive?: boolean }>; isDone: boolean; continueCursor: string | null } = await client.query(api.documents.listManifestPage, { siteSlug, cursor, numItems: 500, includeSensitive: true });
  manifestPages.push(...result.page);
  slugs = manifestPages.filter(page => !page.sensitive).slice(0, 100).map(page => page.slug);
  privateSlug ??= result.page.find(page => page.sensitive)?.slug;
  if (result.isDone) break;
  cursor = result.continueCursor;
}
if (slugs.length < 25) throw new Error("Not enough public pages for profile");
const batch = (count: number) => `/api/wiki/pages?scope=public&slugs=${encodeURIComponent(slugs.slice(0, count).join(","))}`;

// Remove volatile fields, retain ordering and complete content for equality
// checks in memory. Only a one-way digest is written, never payload content.
function semanticHash(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => key === "generatedAt" || key === "manifestHash" ? [] : [[key, clean(item)]]));
  };
  return createHash("sha256").update(JSON.stringify(clean(body))).digest("hex");
}
async function measure(scenario: string, run: number, handler: ReturnType<typeof createWikiApiHandler>, path: string, init: RequestInit = {}) {
  if (scenarioFilter && !scenarioFilter.test(scenario)) return null;
  const headers = new Headers({ Cookie: cookie, "x-wiki-test-run": "1" });
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const started = performance.now();
  const startNs = BigInt(Date.now()) * 1_000_000n;
  const beforeIds = new Set(spans.map(span => span.spanId));
  const response = await handler(new Request(`http://localhost${path}`, { ...init, headers }));
  const readyMs = performance.now() - started;
  if (!response) throw new Error(`Unhandled scenario ${scenario}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const completeMs = performance.now() - started;
  const endNs = BigInt(Date.now()) * 1_000_000n;
  let body: Record<string, unknown> | null = null;
  if (response.headers.get("content-type")?.includes("application/json") && bytes.length) body = JSON.parse(new TextDecoder().decode(bytes));
  await flushBackendTraces();
  const roots = spans.filter(span => !span.parentSpanId && !beforeIds.has(span.spanId));
  const sample: Sample = { variant: activeVariant, scenario, run, status: response.status, readyMs: Math.round(readyMs), completeMs: Math.round(completeMs), bytes: bytes.length, semanticHash: semanticHash(body), resultCount: Array.isArray(body?.pages) ? body.pages.length : Array.isArray(body?.results) ? body.results.length : null, complete: response.headers.get("x-wiki-search-completeness"), responseStartNs: String(startNs), responseEndNs: String(endNs), traceIds: roots.map(span => span.traceId), rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed };
  samples.push(sample);
  const requestTraceIds = new Set(sample.traceIds);
  console.log(JSON.stringify({ variant: activeVariant, scenario, run, status: sample.status, readyMs: sample.readyMs, completeMs: sample.completeMs, bytes: sample.bytes, resultCount: sample.resultCount, complete: sample.complete, calls: spans.filter(span => requestTraceIds.has(span.traceId) && span.name.startsWith("convex.")).length }));
  await writeFile(`${out}/samples.json`, JSON.stringify(samples, null, 2));
  await writeFile(`${out}/spans.json`, JSON.stringify(spans, null, 2));
  return response.headers.get("etag");
}
try {
  for (let run = 1; run <= runs; run++) {
   for (const variant of baseline ? (run % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"]) : ["candidate"]) {
    activeVariant = variant;
    const factory = variant === "baseline" ? baseline!.createWikiApiHandler : createWikiApiHandler;
    const fresh = () => factory(createClient());
    const handler = fresh();
    await measure("gate-denied", run, handler, batch(1), { headers: { Cookie: "" } });
    await measure("session-public", run, handler, "/api/wiki/session?scope=public");
    await measure("session-missing", run, handler, "/api/wiki/session?scope=session");
    await measure("auth-session-anonymous", run, handler, "/api/auth/session");
    const etag = await measure("manifest-cold", run, handler, "/api/wiki/manifest?scope=public");
    await measure("manifest-revalidate", run, handler, "/api/wiki/manifest?scope=public", { headers: { "If-None-Match": etag ?? "" } });
    await measure("page-single-cold", run, handler, batch(1));
    await measure("page-single-warm", run, handler, batch(1));
    await measure("pages-25", run, handler, batch(25));
    await measure("pages-100", run, handler, batch(100));
    await measure("page-missing", run, handler, "/api/wiki/pages?slugs=__backend_profile_missing_9b63");
    if (privateSlug) await measure("page-denied", run, handler, `/api/wiki/pages?slugs=${encodeURIComponent(privateSlug)}`);
    await measure("page-copy", run, handler, `/api/page-copy?slug=${encodeURIComponent(slugs[0]!)}`);
    await measure("prefetch-public", run, handler, "/api/wiki/prefetch?scope=public");
    await measure("timeline", run, handler, "/api/timeline");
    await measure("diagnostic-studies", run, handler, "/api/diagnostic-studies");
    await measure("dicom-studies", run, handler, "/api/dicom/studies");
    await measure("dicom-comparisons", run, handler, "/api/dicom/comparisons");
    const searchHandler = fresh();
    await measure("search-cold", run, searchHandler, "/api/search?q=treatment&limit=100");
    await measure("search-warm", run, searchHandler, "/api/search?q=treatment&limit=100");
    await measure("search-no-match-warm", run, searchHandler, "/api/search?q=__backend_profile_missing_9b63&limit=100");
    await measure("download-markdown-25", run, handler, "/api/download?type=markdown&scope=public&limit=25");
   }
  }
} finally {
  await flushBackendTraces();
  await writeFile(`${out}/spans.json`, JSON.stringify(spans, null, 2));
  collector.stop(true);
}
