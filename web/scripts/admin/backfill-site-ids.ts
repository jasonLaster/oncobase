/**
 * Stamp `siteId` onto every legacy row that pre-dates the multi-tenant
 * migration. Without this, the legacy fallback in `findDocBySlug`,
 * `findAssetByPath`, `getMeta`, etc. can return another site's row when
 * a key (slug, email, roomId, path) collides with Diana — silently
 * breaking Diana once a second site exists.
 *
 * Run BEFORE onboarding any non-Diana site.
 *
 *   bun scripts/admin/backfill-site-ids.ts --dry-run
 *   bun scripts/admin/backfill-site-ids.ts
 */
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../../convex/_generated/api";

dotenv.config({
  path: path.join(__dirname, "..", "..", ".env.local"),
  quiet: true,
});

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

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!url) {
  console.error("NEXT_PUBLIC_CONVEX_URL is not set in web/.env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const client = new ConvexHttpClient(url);

if (dryRun) {
  const rows = await client.query(api.migrations.backfillSiteIdDryRun, {});
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
    const result = (await client.mutation(api.migrations.backfillSiteIdsBatch, {
      table,
      cursor: cursor ?? undefined,
    })) as BatchResult;
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
