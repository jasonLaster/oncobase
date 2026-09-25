import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const { values } = parseArgs({ options: {
  "env-file": { type: "string" }, since: { type: "string", default: "24h" },
  trace: { type: "string" }, query: { type: "string" }, limit: { type: "string", default: "100" },
  help: { type: "boolean" },
} });
if (values.help) {
  console.log("bun scripts/query-traces.ts [--env-file PATH] [--since 24h] [--trace ID] [--limit 100] [--query APL]\nOutputs Axiom tabular JSON. Trace lookup also matches browser/manifest correlation IDs. Query permission is required.");
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
const apl = values.query ?? `['${dataset}']${values.trace ? ` | where trace_id == '${values.trace}' or ['attributes.oncobase.client.trace_id'] == '${values.trace}'` : ""} | order by _time asc | limit ${limit}`;
const response = await fetch(`${(config.AXIOM_URL || "https://api.axiom.co").replace(/\/$/, "")}/v1/query/_apl?format=tabular`, {
  method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ apl, startTime: new Date(Date.now() - ms).toISOString(), endTime: new Date().toISOString() }),
  signal: AbortSignal.timeout(15000), redirect: "error",
});
// Do not echo request headers, credentials, or arbitrary API error bodies.
if (!response.ok) throw new Error(`Axiom query failed (HTTP ${response.status}). Check dataset, region, and query permission.`);
console.log(JSON.stringify(await response.json(), null, 2));
