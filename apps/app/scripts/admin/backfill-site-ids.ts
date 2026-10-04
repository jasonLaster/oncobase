/**
 * Stamp `siteId` onto every legacy row that pre-dates the multi-tenant
 * migration. Without this, the legacy fallback in `findDocBySlug`,
 * `findAssetByPath`, `getMeta`, etc. can return another site's row when
 * a key (slug, email, roomId, path) collides with Diana — silently
 * breaking Diana once a second site exists.
 *
 * Run BEFORE onboarding any non-Diana site.
 *
 *   bun scripts/admin/backfill-site-ids.ts --dry-run [--prod]
 *   bun scripts/admin/backfill-site-ids.ts [--prod]
 *
 * Drives the internal `migrations:*` functions through `bunx convex run`.
 */
import { internal } from "../../convex/_generated/api";
import { convexRun, splitDeploymentFlags } from "./convex-run";

const TABLES = [
  "documents",
  "meta",
  "pdfAssets",
  "fileAssets",
  "conversations",
  "messages",
  "users",
  "guestNames",
  "commentRooms",
  "userSessions",
] as const;
type Table = (typeof TABLES)[number];

const { deployment, rest: args } = splitDeploymentFlags(process.argv.slice(2));
const dryRun = args.includes("--dry-run");

if (dryRun) {
  const rows = convexRun(internal.migrations.backfillSiteIdDryRun, {}, deployment);
  let totalNeedsBackfill = 0;
  console.log("Table              total      needs-backfill");
  console.log("-----              -----      ---------------");
  for (const r of rows) {
    totalNeedsBackfill += r.needsBackfill;
    console.log(
      `${r.table.padEnd(18)} ${String(r.total).padStart(6)}     ${String(r.needsBackfill).padStart(6)}`,
    );
  }
  console.log("");
  console.log(
    totalNeedsBackfill === 0
      ? "Nothing to backfill — all rows already carry a siteId."
      : `Run without --dry-run to stamp ${totalNeedsBackfill} legacy rows with the Diana siteId.`,
  );
  process.exit(0);
}

type BatchResult = {
  table: Table;
  scanned: number;
  patched: number;
  hasMore: boolean;
  cursor: string | null;
};

let grandPatched = 0;
for (const table of TABLES) {
  let cursor: string | null = null;
  let scanned = 0;
  let patched = 0;
  for (;;) {
    const result: BatchResult = convexRun(internal.migrations.backfillSiteIdsBatch, {
      table,
      cursor: cursor ?? undefined,
    }, deployment);
    scanned += result.scanned;
    patched += result.patched;
    if (!result.hasMore) break;
    cursor = result.cursor;
  }
  grandPatched += patched;
  console.log(
    `${table.padEnd(18)} scanned=${scanned} patched=${patched}`,
  );
}
console.log("");
console.log(`Done. Patched ${grandPatched} rows total.`);
