/** Pre-deployment experiment: selected reads against the existing production
 * query API. This bypasses the publish HTTP route and does not verify raw bytes.
 * Only fixed counts/timings are emitted; returned content stays in memory. */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { createBackendClient } from "../server/backend-client";
import { api, internal } from "../convex/_generated/api";
import { loadConfig } from "../../../packages/oncobase/src/config";
import { readPublishScope, readPublishSelection } from "../../../packages/oncobase/src/publish-scope";
import { installPublishProfile } from "../../../packages/oncobase/src/publish-profile";

const { values } = parseArgs({ options: {
  operator: { type: "boolean" }, site: { type: "string" }, vault: { type: "string" }, "files-from": { type: "string" },
  profile: { type: "string" }, output: { type: "string" },
  concurrency: { type: "string", default: "4" }, repeat: { type: "string", default: "3" },
} });
if (!values.site || !values["files-from"] || !values.profile || !values.output) throw new Error("Provide --site, --files-from, --profile and --output");
const concurrency = Number(values.concurrency), repeat = Number(values.repeat);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 || !Number.isInteger(repeat) || repeat < 1 || repeat > 10) throw new Error("Invalid concurrency or repeat");
if (fs.existsSync(values.output) || fs.existsSync(values.profile)) throw new Error("Choose new output paths");
const profile = installPublishProfile(values.profile);
const config = loadConfig(values.site);
const scope = readPublishScope(values["files-from"]);
const documents = readPublishSelection(values.vault ?? config.vaultPath, scope, "none").documents;
if (documents.length > 1000) throw new Error("Probe is limited to 1000 documents");
const client = createBackendClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL, { fetch: Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  // Transport-level guard: this experiment is incapable of mutations/actions.
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname !== "/api/query") throw new Error("Read-only query transport");
  return fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
}, { preconnect: fetch.preconnect }) });
if (values.operator) {
  const key = process.env.CONVEX_DEPLOY_KEY;
  if (!key || !(process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL)) throw new Error("--operator requires explicit backend URL and CONVEX_DEPLOY_KEY");
  (client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(key);
}
const query = values.operator ? internal.documents.internal_getBySlug : api.documents.getBySlug;
const samples = [];
for (let iteration = 1; iteration <= repeat; iteration++) {
  let next = 0, found = 0, matches = 0, returnedBytes = 0;
  const start = performance.now();
  await profile.span("verify.documents", async () => {
    await Promise.all(Array.from({ length: Math.min(concurrency, documents.length) }, async () => {
      for (;;) {
        const doc = documents[next++];
        if (!doc) return;
        await profile.span("state.lookup", async () => {
          const remote = await client.query(query as typeof api.documents.getBySlug, { siteSlug: config.site, slug: doc.slug, includeSensitive: true });
          const bytes = Buffer.byteLength(JSON.stringify(remote));
          profile.metric("responseBytes", bytes);
          returnedBytes += bytes;
          if (remote) found++;
          if (remote?.contentHash === doc.hash && (remote.sensitive === true) === doc.sensitive && JSON.stringify(remote.sensitiveInclude) === JSON.stringify(doc.sensitiveInclude)) matches++;
        });
      }
    }));
  });
  const sample = { iteration, durationMs: Math.round(performance.now() - start), requests: documents.length, found, metadataMatches: matches, returnedBytes };
  samples.push(sample);
  console.log(JSON.stringify(sample));
}
const report = { mode: "read-only-existing-indexed-queries", operator: values.operator ?? false, concurrency, samples,
  limitations: ["bypasses publisher HTTP route", "one query per document, not the new batch query", "stored hash/visibility comparison only", "no raw-content verification", "no writes or lock contention"] };
fs.writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
