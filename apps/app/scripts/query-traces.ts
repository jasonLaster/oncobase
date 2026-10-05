import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const { values } = parseArgs({ options: {
  "env-file": { type: "string" }, since: { type: "string", default: "24h" },
  trace: { type: "string" }, query: { type: "string" }, limit: { type: "string", default: "100" }, report: { type: "boolean" },
  "timeout-ms": { type: "string", default: "60000" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("bun scripts/query-traces.ts [--env-file PATH] [--since 24h] [--trace ID] [--limit 100] [--query APL] [--report] [--timeout-ms 60000]\nOutputs Axiom tabular JSON. Trace lookup also matches browser/manifest correlation IDs. --report prints aggregate bottleneck tables over the full window. Query permission is required.");
  process.exit(0);
}
const file = values["env-file"] ?? [resolve(".env.local"), resolve("../../.env.local")].find(existsSync);
const config = { ...(file ? parse(readFileSync(file)) : {}), ...process.env };
const key = config.AXIOM_QUERY_API_KEY || config.AXIOM_API_KEY;
if (!key) throw new Error("Set AXIOM_QUERY_API_KEY or AXIOM_API_KEY in the environment or --env-file.");
const dataset = config.AXIOM_DATASET || "oncobase-traces";
if (!/^[a-zA-Z0-9_-]+$/.test(dataset)) throw new Error("Invalid AXIOM_DATASET.");
const since = /^(\d+)(m|h|d)$/.exec(values.since!);
const ms = since ? Number(since[1]) * ({ m: 60000, h: 3600000, d: 86400000 }[since[2]!] ?? 0) : 0;
if (ms < 60000 || ms > 30 * 86400000) throw new Error("--since must be 1m through 30d.");
const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be 1 through 1000.");
if (values.trace && !/^[a-f0-9]{32}$/.test(values.trace)) throw new Error("--trace must be a 32-character lowercase hex trace ID.");
const apl = values.query ?? `['${dataset}']${values.trace ? ` | where trace_id == '${values.trace}' or ['attributes.custom']['oncobase.client.trace_id'] == '${values.trace}'` : ""} | order by _time asc | limit ${limit}`;
const timeoutMs = Number(values["timeout-ms"]);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error("--timeout-ms must be 1000 through 60000.");
type Table = { fields: Array<{ name: string }>; columns: unknown[][] };
async function query(text: string): Promise<{ tables: Table[] }> {
  let response: Response;
  try {
    response = await fetch(`${(config.AXIOM_URL || "https://api.axiom.co").replace(/\/$/, "")}/v1/query/_apl?format=tabular`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ apl: text, startTime: new Date(Date.now() - ms).toISOString(), endTime: new Date().toISOString() }),
      signal: AbortSignal.timeout(timeoutMs), redirect: "error",
    });
  } catch {
    console.error(`Axiom query did not complete within the network/timeout budget (${timeoutMs}ms). Narrow --since or the query and retry.`);
    process.exit(1);
  }
  // Do not echo request headers, credentials, or arbitrary API error bodies.
  if (!response.ok) throw new Error(`Axiom query failed (HTTP ${response.status}). Check dataset, region, and query permission.`);
  return await response.json() as { tables: Table[] };
}

if (!values.report) {
  console.log(JSON.stringify(await query(apl), null, 2));
  process.exit(0);
}

// Axiom hoists some semantic-convention attributes into columns and keeps the
// rest in attributes.custom. Referencing a missing column is a query error.
const columns = new Set((await query(`['${dataset}'] | getschema`)).tables[0]!.columns[0]!.map(String));
const attr = (name: string) => columns.has(`attributes.${name}`) ? `['attributes.${name}']` : `['attributes.custom']['${name}']`;
const num = (name: string) => `todouble(${attr(name)})`;
const ds = `['${dataset}']`;
const caches = ["site-host", "canonical-slugs", "pii-patterns", "search-corpus", "manifest-snapshot", "manifest-derived"];
const sections: Array<[string, string]> = [
  ["Span latency by name (ms; total = serial-equivalent seconds)",
    `${ds} | extend ms = duration / 1ms | summarize n=count(), p50=percentile(ms, 50), p95=percentile(ms, 95), p99=percentile(ms, 99), total_s=sum(ms) / 1000 by name | order by total_s desc | take 40`],
  ["Convex RPCs by request route",
    `${ds} | where name startswith 'convex.' | join kind=inner (${ds} | where kind == 'server' | project trace_id, route=name) on trace_id | extend ms = duration / 1ms | summarize n=count(), p50=percentile(ms, 50), p95=percentile(ms, 95), max=max(ms), total_s=sum(ms) / 1000 by route, name | order by total_s desc | take 25`],
  ["Self time: request duration not covered by direct child spans (untraced CPU, serialization)",
    `${ds} | where kind == 'server' | join kind=leftouter (${ds} | where isnotempty(parent_span_id) | summarize child_ms=sum(duration / 1ms) by span_id=parent_span_id) on span_id | extend ms = duration / 1ms, self_ms = max_of(0.0, duration / 1ms - coalesce(child_ms, 0.0)) | summarize n=count(), p50=percentile(ms, 50), self_p50=percentile(self_ms, 50), self_p95=percentile(self_ms, 95), self_total_s=sum(self_ms) / 1000 by name | order by self_total_s desc | take 20`],
  ["Platform: cold starts, in-instance concurrency, event-loop saturation",
    `${ds} | where kind == 'server' | extend ms = duration / 1ms, cold = tostring(${attr("faas.coldstart")}) == 'true' | summarize n=count(), cold=countif(cold), warm_p50=percentileif(ms, 50, not(cold)), cold_p50=percentileif(ms, 50, cold), init_p50=percentile(${num("faas.init_ms")}, 50), inflight_p95=percentile(${num("process.inflight_requests")}, 95), elu_p95=percentile(${num("nodejs.eventloop.utilization")}, 95) by name | order by n desc | take 20`],
  ["Per-instance cache effectiveness",
    `${ds} | where kind == 'server' | summarize ${caches.flatMap((cache, index) => [`h${index}=sum(${num(`cache.${cache}.hits`)})`, `m${index}=sum(${num(`cache.${cache}.misses`)})`]).join(", ")} | project ${caches.map((cache, index) => `['${cache}']=strcat(tostring(h${index}), ' hit / ', tostring(m${index}), ' miss')`).join(", ")}`],
  // manifest.strategy: snapshot (public), snapshot-education[-cached], snapshot-overlay[-cached]
  // (signed-in), manifest (live fallback). Phases are the manifest.* spans below.
  ["Manifest: latency by strategy, scope and validator (-cached = memoized derivation)",
    `${ds} | where kind == 'server' and isnotempty(${attr("manifest.strategy")}) | extend ms = duration / 1ms | summarize n=count(), p50=percentile(ms, 50), p95=percentile(ms, 95), p99=percentile(ms, 99) by strategy=tostring(${attr("manifest.strategy")}), scope=tostring(${attr("manifest.scope")}), validator=tostring(${attr("manifest.validator")}) | order by n desc | take 30`],
  ["Manifest: phase cost (overlay vs assets = the two parallel reads; snapshot-derive/tree/hash/serialize = recompute on a derivation miss)",
    `${ds} | where name startswith 'manifest.' and name !startswith 'manifest.snapshot-read' | extend ms = duration / 1ms | summarize n=count(), p50=percentile(ms, 50), p95=percentile(ms, 95), total_s=sum(ms) / 1000 by name | order by total_s desc | take 20`],
  ["Failures by span and error class",
    `${ds} | where ['status.code'] == 'ERROR' or error == true | summarize n=count() by name, error_type=tostring(${attr("error.type")}) | order by n desc | take 20`],
  // Text search requests (both /api/search and the education alias) carry search.mode.
  ["Search: mode mix and latency by mode (indexed = cold instance answered from the relevance index)",
    `${ds} | where kind == 'server' and isnotempty(${attr("search.mode")}) | extend ms = duration / 1ms, mode = tostring(${attr("search.mode")}), wait = tostring(${attr("search.wait")}) | summarize n=count(), p50=percentile(ms, 50), p95=percentile(ms, 95), p99=percentile(ms, 99), max=max(ms) by mode, wait | order by n desc`],
  ["Search: corpus loads behind exhaustive answers (state miss = the request waited for a cold load)",
    `${ds} | where kind == 'server' and isnotempty(${attr("search.corpus.load_ms")}) | extend state = tostring(${attr("search.corpus.state")}) | summarize n=count(), load_p50=percentile(${num("search.corpus.load_ms")}, 50), load_p95=percentile(${num("search.corpus.load_ms")}, 95), prepare_p50=percentile(${num("search.corpus.prepare_ms")}, 50), rpcs_p50=percentile(${num("search.corpus.rpcs")}, 50), ranges_p50=percentile(${num("search.corpus.ranges")}, 50), reused_p50=percentile(${num("search.corpus.reused_ranges")}, 50), pages_max=max(${num("search.corpus.pages")}), mchars_max=max(${num("search.corpus.characters")}) / 1000000 by state | order by n desc`],
  ["Browser: duration vs server time (gap = network, CDN, platform)",
    `${ds} | where name startswith 'reader.' or name startswith 'observation.reader.' | extend ms = coalesce(${num("measurement.duration_ms")}, duration / 1ms), server = ${num("server.duration_ms")}, cached = tostring(${attr("reader.cached")}) | summarize n=count(), p50=percentile(ms, 50), p75=percentile(ms, 75), p95=percentile(ms, 95), server_p50=percentile(server, 50), gap_p75=percentile(ms - server, 75) by name, cached | order by name asc | take 60`],
  // Marks are ms since navigation. resource-* spans: ms = first fetch start to
  // last response end, offset = fetch start since navigation, bytes = transfer.
  ["Browser boot: critical path (ms since navigation; resources: offset + fetch span, bytes, cache-hit share)",
    `${ds} | where name matches regex '^(observation[.])?reader[.](boot-|store-|resource-|identity-|storage-ready|reader-ready|reader-live-handoff|vital-lcp)' | extend span = extract('(reader[.].*)$', 1, name) | extend ms = coalesce(${num("measurement.duration_ms")}, duration / 1ms), offset = ${num("reader.offset_ms")}, bytes = ${num("reader.transfer_bytes")}, cached = tostring(${attr("reader.cached")}) == 'true' | summarize n=count(), p50=percentile(ms, 50), p75=percentile(ms, 75), p95=percentile(ms, 95), offset_p50=percentile(offset, 50), end_p50=percentile(offset + ms, 50), bytes_p50=percentile(bytes, 50), cached_pct=100.0 * countif(cached) / count() by span | order by p50 asc | take 60`],
  // fast = guarded local OPFS image; leader = no local state; fallback-* = the
  // guard rejected the local image (journal, changed between reads, invalid
  // header, storage error); memory = temporary store. store-fast-path is the
  // guard's own read cost (directory scans + two full reads).
  ["Browser boot: store snapshot path (share and boot timings by path)",
    `${ds} | where name matches regex '^(observation[.])?reader[.](store-adapter|store-boot-complete|store-fast-path)$' | extend span = extract('(reader[.].*)$', 1, name), path = tostring(${attr("reader.store_path")}) | extend ms = coalesce(${num("measurement.duration_ms")}, duration / 1ms) | summarize n=count(), p50=percentile(ms, 50), p75=percentile(ms, 75), p95=percentile(ms, 95) by span, path | order by span asc, n desc | take 40`],
  ["Browser boot: store-timeout and sync-error reasons",
    `${ds} | where name matches regex '^(observation[.])?reader[.](store-timeout|sync-error)$' | extend span = extract('(reader[.].*)$', 1, name) | summarize n=count() by span, reason=tostring(${attr("reader.reason")}) | order by n desc | take 30`],
  // Cached public page meets a verified session: kept-mounted swaps once the
  // session store holds the route; wait = identity to swap, offset = swap since navigation.
  ["Browser: session handoff outcomes (wait = identity to visible store swap)",
    `${ds} | where name matches regex '^(observation[.])?reader[.]session-handoff$' | extend ms = coalesce(${num("measurement.duration_ms")}, duration / 1ms), offset = ${num("reader.offset_ms")} | summarize n=count(), wait_p50=percentile(ms, 50), wait_p95=percentile(ms, 95), offset_p50=percentile(offset, 50) by outcome=tostring(${attr("reader.handoff_outcome")}) | order by n desc`],
];
for (const [title, text] of sections) {
  const table = (await query(text)).tables[0]!;
  console.log(`\n## ${title}\n${table.fields.map(field => field.name).join("\t")}`);
  for (let row = 0; row < (table.columns[0]?.length ?? 0); row++) {
    console.log(table.columns.map(column => { const value = column[row]; return typeof value === "number" ? Number(value.toFixed(1)) : value ?? ""; }).join("\t"));
  }
}
