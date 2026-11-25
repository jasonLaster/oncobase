#!/usr/bin/env node
// Import each published page's past versions from the vault's git history
// into page history. The server redacts bodies with the site's PII patterns
// and skips versions it already holds (or that match the live page), so this
// is safe to re-run.
import { hasFlag, readFlag } from "./cli";
import { loadConfig, loadPublishToken } from "./config";
import { batchVersions, readDocumentHistory } from "./git-history";
import { publisherPost } from "./publish-post";
import { readVaultDocuments } from "./walk-vault";

function usage() {
  console.error("Usage: oncobase docs:backfill-history --site <slug> [--slug <slug>...] [--max-per-page <n>] [--dry-run]");
}

function readFlags(args: string[], name: string) {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) values.push(args[i + 1]);
  return values;
}

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
if (!site) {
  usage();
  process.exit(1);
}
const dryRun = hasFlag(args, "--dry-run");
const maxPerPage = Number(readFlag(args, "--max-per-page") ?? 200);
if (!Number.isInteger(maxPerPage) || maxPerPage < 1 || maxPerPage > 1000) {
  console.error("--max-per-page must be an integer from 1 to 1000");
  process.exit(1);
}

const config = loadConfig(site);
const published = new Set(readVaultDocuments(config.vaultPath).map(doc => doc.slug));
const requested = readFlags(args, "--slug");
const unknown = requested.filter(slug => !published.has(slug));
if (unknown.length) {
  console.error(`Not pages in this vault: ${unknown.join(", ")}`);
  process.exit(1);
}
const slugs = new Set(requested.length ? requested : published);
const history = readDocumentHistory(config.vaultPath, slugs, { maxPerPage });
const total = [...history.values()].reduce((sum, versions) => sum + versions.length, 0);
console.log(`${history.size} pages have ${total} committed revisions (newest ${maxPerPage} per page).`);
if (dryRun) process.exit(0);

const token = loadPublishToken(site);
let inserted = 0, skipped = 0, missing = 0, done = 0;
for (const [slug, versions] of history) {
  for (const batch of batchVersions(versions)) {
    const result = await publisherPost<{ found: boolean; inserted: number; skipped: number }>(
      `${config.publishUrl}/versions`, token, { siteSlug: config.site, slug, versions: batch },
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!result.found) { missing++; break; }
    inserted += result.inserted;
    skipped += result.skipped;
  }
  if (++done % 100 === 0) console.log(`  ${done}/${history.size} pages`);
}
console.log(`Imported ${inserted} past versions (${skipped} already stored or identical to the live page; ${missing} pages not published yet).`);
