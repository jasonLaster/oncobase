/**
 * One-shot backfill: replace legacy `contentHash` values with the new
 * publisher-style hash so wiki:check reflects the real diff.
 *
 * Background. Until commit afd82ad2 ("runtime: read wiki content from
 * Convex and Blob"), the build pipeline ran `scripts/ingest-wiki.ts`,
 * which stored `contentHash = sha256(redactedContent).slice(0,16)`.
 * The new publisher computes `hashDocument({title, content, tags, sensitive, sensitiveInclude})`
 * over the *raw* (un-redacted) local content. The two functions
 * disagree, so every legacy doc registers as "changed" even when it
 * wasn't.
 *
 * Strategy:
 *   - For every local vault doc that was NOT modified after the
 *     operator-supplied boundary (`--since-ref`), compute the new-style
 *     hash and patch it onto the matching remote row.
 *   - For docs that WERE touched after the boundary (today's edits),
 *     leave the old hash in place. Those will surface as "changed" in
 *     the next `wiki:check` and republish through the normal flow.
 *
 *   bun scripts/admin/backfill-content-hashes.ts --site diana --dry-run --since-ref HEAD~1
 *   bun scripts/admin/backfill-content-hashes.ts --site diana --since-ref HEAD~1
 *   bun scripts/admin/backfill-content-hashes.ts --site diana --backfill-all
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../../convex/_generated/api";
import {
  HASH_FUNCTION_VERSION,
  hashDocument,
  loadConfig,
  readFlag,
  readVaultDocuments,
} from "@oncobase/oncobase";
import { changedSlugsSinceRef } from "./changed-slugs";

dotenv.config({
  path: path.join(__dirname, "..", "..", ".env.local"),
  quiet: true,
});

const args = process.argv.slice(2);
const siteSlug = readFlag(args, "--site");
const dryRun = args.includes("--dry-run");
const sinceRef = readFlag(args, "--since-ref");
const backfillAll = args.includes("--backfill-all");

function readFlags(name: string) {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1]) values.push(args[i + 1]);
  }
  return values;
}

if (!siteSlug) {
  console.error(
    "Usage: bun scripts/admin/backfill-content-hashes.ts --site <slug> [--dry-run] (--since-ref <commit> | --backfill-all) [--skip-slug <slug>...]",
  );
  process.exit(1);
}

if (!sinceRef && !backfillAll) {
  console.error(
    "Refusing to backfill without a boundary. Pass --since-ref <commit> to protect recent edits, or --backfill-all for an intentional full hash migration.",
  );
  process.exit(1);
}

if (sinceRef && backfillAll) {
  console.error("Use either --since-ref or --backfill-all, not both.");
  process.exit(1);
}

const config = loadConfig(siteSlug);
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  console.error("NEXT_PUBLIC_CONVEX_URL is not set");
  process.exit(1);
}

function gitRootForPath(targetPath: string) {
  return execFileSync("git", ["-C", targetPath, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

const vaultGitRoot = gitRootForPath(config.vaultPath);
const vaultRel = path.relative(vaultGitRoot, config.vaultPath) || ".";

const skipSlugs = new Set(readFlags("--skip-slug"));
if (sinceRef) {
  for (const slug of changedSlugsSinceRef({
    cwd: vaultGitRoot,
    vaultRel,
    ref: sinceRef,
  })) {
    skipSlugs.add(slug);
  }
}
console.log(`Vault git root: ${vaultGitRoot}`);
console.log(`Vault pathspec: ${vaultRel}`);
console.log(
  sinceRef
    ? `Skipping ${skipSlugs.size} slugs touched since ${sinceRef}:`
    : `Skipping ${skipSlugs.size} explicitly protected slugs:`,
);
for (const s of [...skipSlugs].sort()) console.log("  -", s);

const localDocs = readVaultDocuments(config.vaultPath);
const localBySlug = new Map(localDocs.map((d) => [d.slug, d]));
console.log(`\nLocal vault docs: ${localDocs.length}`);

const client = new ConvexHttpClient(url);

// Each bulk mutation reads the full document for every entry to
// compare hashes. With ~22KB avg and outliers approaching 150KB,
// 200/batch hits Convex's 16MB-per-call read limit. 50/batch keeps
// the worst case (50 × 150KB ≈ 7.5MB) well under the cap.
const BATCH_SIZE = 50;

let cursor: string | null = null;
let scanned = 0;
let alreadyMatching = 0;
let patched = 0;
let skippedTouched = 0;
let missingLocal = 0;

let pendingBatch: Array<{ slug: string; contentHash: string }> = [];

async function flushBatch() {
  if (pendingBatch.length === 0) return;
  const entries = pendingBatch;
  pendingBatch = [];
  if (dryRun) {
    patched += entries.length;
    return;
  }
  const result = await client.mutation(api.documents.bulkSetContentHash, {
    siteSlug,
    hashFunctionVersion: HASH_FUNCTION_VERSION,
    entries,
  });
  patched += result.patched;
  alreadyMatching += result.alreadyMatching;
  missingLocal += result.missing;
}

while (true) {
  const page: {
    page: Array<{
      slug: string;
      title: string;
      content: string;
      tags: string[];
      sensitiveInclude?: string[];
      contentHash?: string;
      sensitive?: boolean;
    }>;
    isDone: boolean;
    continueCursor: string;
  } = await client.query(api.documents.listPageWithContent, {
    cursor,
    numItems: 200,
    siteSlug,
    includeSensitive: true,
  });

  for (const remote of page.page) {
    scanned++;
    const local = localBySlug.get(remote.slug);
    if (!local) {
      missingLocal++;
      continue;
    }
    if (skipSlugs.has(remote.slug)) {
      skippedTouched++;
      continue;
    }
    const newHash = hashDocument({
      title: local.title,
      content: local.content,
      tags: local.tags,
      sensitive: local.sensitive,
      sensitiveInclude: local.sensitiveInclude,
    });
    if (remote.contentHash === newHash) {
      alreadyMatching++;
      continue;
    }
    pendingBatch.push({ slug: remote.slug, contentHash: newHash });
    if (pendingBatch.length >= BATCH_SIZE) {
      await flushBatch();
    }
  }

  process.stdout.write(
    `\rscanned=${scanned} patched=${patched} alreadyMatching=${alreadyMatching} skippedTouched=${skippedTouched} missingLocal=${missingLocal}`,
  );

  if (page.isDone) break;
  cursor = page.continueCursor;
}

await flushBatch();

process.stdout.write("\n");
console.log(
  `${dryRun ? "[dry-run] would patch" : "patched"} ${patched} docs ` +
    `(already matching: ${alreadyMatching}, skipped touched: ${skippedTouched}, ` +
    `missing local: ${missingLocal}, total scanned: ${scanned})`,
);
