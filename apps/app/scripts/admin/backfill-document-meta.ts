/** Backfill and verify the `documentMeta` projection (convex/documentMeta.ts).
 * Supply the intended deployment URL and CONVEX_DEPLOY_KEY (or a local admin
 * key) through the environment.
 *
 *   bun scripts/admin/backfill-document-meta.ts --site diana            # backfill, switch readers, verify
 *   bun scripts/admin/backfill-document-meta.ts --site diana --no-ready # backfill + verify, readers stay on documents
 *   bun scripts/admin/backfill-document-meta.ts --site diana --verify   # verify only
 *   bun scripts/admin/backfill-document-meta.ts --all                   # every active site
 *   bun scripts/admin/backfill-document-meta.ts --site diana --rollback # readers back to documents
 *
 * Batches are idempotent; rerunning after an interruption simply resumes from
 * the start and writes only rows that differ. Output is aggregate counts and
 * document ids only.
 */
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { createBackendClient } from "../../server/backend-client";
import { internal } from "../../convex/_generated/api";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const siteIndex = args.indexOf("--site");
const siteSlug = siteIndex === -1 ? undefined : args[siteIndex + 1];
if (siteIndex !== -1 && (!siteSlug || !/^[a-z0-9-]{1,32}$/.test(siteSlug))) throw new Error("Use --site <slug>");
if (!siteSlug && !flag("--all")) throw new Error("Use --site <slug> or --all");
const key = process.env.CONVEX_DEPLOY_KEY;
const url = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
if (!key || !url) throw new Error("An explicit deployment URL and CONVEX_DEPLOY_KEY are required");

const client = createBackendClient(url, { logger: false }) as unknown as {
  setAdminAuth(key: string): void;
  query<Q extends FunctionReference<"query", "internal">>(fn: Q, args: FunctionArgs<Q>): Promise<FunctionReturnType<Q>>;
  mutation<M extends FunctionReference<"mutation", "internal">>(fn: M, args: FunctionArgs<M>): Promise<FunctionReturnType<M>>;
};
client.setAdminAuth(key);

async function backfill(site: string) {
  const totals = { batches: 0, scanned: 0, inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
  let cursor: string | null = null;
  let readyAt: number | null = null;
  const started = performance.now();
  for (;;) {
    const result: FunctionReturnType<typeof internal.documentMeta.backfillBatch> = await client.mutation(internal.documentMeta.backfillBatch, { siteSlug: site, cursor, markReady: !flag("--no-ready") });
    totals.batches++;
    for (const field of ["scanned", "inserted", "updated", "deleted", "unchanged"] as const) totals[field] += result[field];
    readyAt = result.readyAt;
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  console.log(JSON.stringify({ site, step: "backfill", ...totals, readyAt, elapsedMs: Math.round(performance.now() - started) }));
}

async function verify(site: string) {
  const totals = { scanned: 0, missing: 0, stale: 0, duplicated: 0 };
  const examples: string[] = [];
  let cursor: string | null = null;
  let readyAt: number | null = null;
  for (;;) {
    const page: FunctionReturnType<typeof internal.documentMeta.verifyBatch> = await client.query(internal.documentMeta.verifyBatch, { siteSlug: site, cursor });
    totals.scanned += page.scanned; totals.missing += page.missingCount; totals.stale += page.staleCount; totals.duplicated += page.duplicatedCount;
    examples.push(...page.missing, ...page.stale);
    readyAt = page.readyAt;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  const ok = totals.missing === 0 && totals.stale === 0 && totals.duplicated === 0;
  console.log(JSON.stringify({ site, step: "verify", ok, ...totals, readyAt, examples: examples.slice(0, 10) }));
  return ok;
}

const sites = siteSlug ? [siteSlug] : (await client.query(internal.documentMeta.status, {})).filter(site => site.status === "active").map(site => site.siteSlug);
let failures = 0;
for (const site of sites) {
  if (flag("--rollback")) {
    console.log(JSON.stringify({ site, step: "rollback", ...(await client.mutation(internal.documentMeta.setReady, { siteSlug: site, ready: false })) }));
    continue;
  }
  if (!flag("--verify")) await backfill(site);
  if (!(await verify(site))) failures++;
}
if (failures) {
  console.error(`${failures} site(s) failed verification; rerun the backfill (it repairs drift) or --rollback`);
  process.exit(1);
}
