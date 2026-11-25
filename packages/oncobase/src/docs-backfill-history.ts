#!/usr/bin/env node
// Import each published page's past versions from the vault's git history
// into page history. The server redacts bodies with the site's PII patterns
// and skips versions it already holds (or that match the live page), so this
// is safe to re-run.
import { hasFlag, readFlag } from "./cli";
import { loadConfig, loadPublishToken } from "./config";
import { batchVersions, readDocumentHistory, type PastVersion } from "./git-history";
import { runWithConcurrency } from "./publish-concurrency";
import { publisherPost } from "./publish-post";
import { readVaultDocuments } from "./walk-vault";

function usage() {
  console.error("Usage: oncobase docs:backfill-history --site <slug> [--vault <path>] [--slug <slug>...] [--max-per-page <n>] [--dry-run]");
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
const vaultPath = readFlag(args, "--vault") ?? config.vaultPath;
const published = new Set(readVaultDocuments(vaultPath).map(doc => doc.slug));
const requested = readFlags(args, "--slug");
const unknown = requested.filter(slug => !published.has(slug));
if (unknown.length) {
  console.error(`Not pages in this vault: ${unknown.join(", ")}`);
  process.exit(1);
}
const slugs = new Set(requested.length ? requested : published);
const history = readDocumentHistory(vaultPath, slugs, { maxPerPage });
const total = [...history.values()].reduce((sum, versions) => sum + versions.length, 0);
console.log(`${history.size} pages have ${total} committed revisions (newest ${maxPerPage} per page).`);
if (dryRun) process.exit(0);

const token = loadPublishToken(site);
const uploadBytesPerSecond = 2 * 1024 * 1024;
let nextUploadAt = 0;
let inserted = 0, skipped = 0, oversized = 0, missing = 0, done = 0;

async function uploadVersions(slug: string, versions: PastVersion[]) {
  const payload = { siteSlug: config.site, slug, versions };
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  for (let attempt = 0; ; attempt++) {
    // All workers share this budget so a busy page cannot starve ongoing publishes.
    const now = Date.now();
    const startAt = Math.max(now, nextUploadAt);
    nextUploadAt = startAt + Math.ceil(bytes * 1000 / uploadBytesPerSecond);
    if (startAt > now) await new Promise(resolve => setTimeout(resolve, startAt - now));
    try {
      return await publisherPost<{ found: boolean; inserted: number; skipped: number; oversized?: number }>(
        `${config.publishUrl}/versions`, token, payload, { signal: AbortSignal.timeout(60_000) },
      );
    } catch (error) {
      // Batch imports are idempotent, including when a response is lost after a write.
      const transient = error instanceof Error && (
        error.name === "TimeoutError" || /TooManyWrites|^(429|502|503|504)\b/.test(error.message)
      );
      if (!transient || attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

await runWithConcurrency([...history], 16, async ([slug, versions]) => {
  for (const batch of batchVersions(versions, { maxBytes: uploadBytesPerSecond / 2 })) {
    const result = await uploadVersions(slug, batch);
    if (!result.found) { missing++; break; }
    inserted += result.inserted;
    skipped += result.skipped;
    oversized += result.oversized ?? 0;
  }
  if (++done % 100 === 0) console.log(`  ${done}/${history.size} pages`);
});
console.log(`Imported ${inserted} past versions (${skipped} already stored or identical to the live page; ${oversized} exceeded the Convex document limit; ${missing} pages not published yet).`);
