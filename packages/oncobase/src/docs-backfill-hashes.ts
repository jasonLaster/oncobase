#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { hasFlag, readFlag } from "./cli";
import { loadConfig, loadPublishToken } from "./config";
import { readErrorBody } from "./http";
import {
  HASH_FUNCTION_VERSION,
  readVaultDocuments,
  type PublishDocument,
} from "./walk-vault";
import { PUBLISHER_PROTOCOL_VERSION, PUBLISHER_VERSION_HEADER } from "./version";

type BeginResponse = {
  missingDocumentSlugs: string[];
  staleHashVersionSlugs?: string[];
};

type BackfillResult = {
  patched?: number;
  alreadyMatching?: number;
  missing?: number;
};

function usage() {
  console.error(
    "Usage: oncobase docs:backfill-hashes --site <slug> [--dry-run] (--since-ref <commit> | --backfill-all) [--skip-slug <slug>...]",
  );
}

function readFlags(args: string[], name: string) {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1]) values.push(args[i + 1]);
  }
  return values;
}

function gitRootForPath(targetPath: string) {
  return execFileSync("git", ["-C", targetPath, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function slugsFromGitOutput(raw: string, vaultRel: string) {
  const slugs = new Set<string>();
  const prefix = vaultRel.endsWith("/") ? vaultRel : `${vaultRel}/`;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!/\.(?:md|mdx)$/i.test(trimmed)) continue;
    const rel = trimmed.startsWith(prefix)
      ? trimmed.slice(prefix.length)
      : trimmed;
    slugs.add(rel.replace(/\.(?:md|mdx)$/i, ""));
  }
  return slugs;
}

function changedSlugsSinceRef(vaultPath: string, ref: string) {
  const vaultGitRoot = gitRootForPath(vaultPath);
  const vaultRel = path.relative(vaultGitRoot, vaultPath) || ".";
  const raw = execFileSync(
    "git",
    [
      "log",
      `${ref}..HEAD`,
      "--name-only",
      "--pretty=format:",
      "--",
      `${vaultRel}/`,
    ],
    { cwd: vaultGitRoot, encoding: "utf8" },
  );
  return {
    vaultGitRoot,
    vaultRel,
    slugs: slugsFromGitOutput(raw, vaultRel),
  };
}

async function post(url: string, token: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      [PUBLISHER_VERSION_HEADER]: String(PUBLISHER_PROTOCOL_VERSION),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 426) {
      throw new Error(
        `${await response.text()}\nUpdate @oncobase/oncobase, then retry.`,
      );
    }
    throw new Error(`${response.status} ${await readErrorBody(response)}`);
  }
  return await response.json();
}

async function backfillDocumentHashes(
  publishUrl: string,
  token: string,
  siteSlug: string,
  docs: PublishDocument[],
) {
  let patched = 0;
  let alreadyMatching = 0;
  let missing = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = docs.slice(i, i + 500);
    const result = (await post(`${publishUrl}/document-hashes`, token, {
      siteSlug,
      hashFunctionVersion: HASH_FUNCTION_VERSION,
      entries: batch.map((doc) => ({
        slug: doc.slug,
        contentHash: doc.hash,
      })),
    })) as BackfillResult;
    patched += result.patched ?? 0;
    alreadyMatching += result.alreadyMatching ?? 0;
    missing += result.missing ?? 0;
  }
  return { patched, alreadyMatching, missing };
}

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
const dryRun = hasFlag(args, "--dry-run");
const sinceRef = readFlag(args, "--since-ref");
const backfillAll = hasFlag(args, "--backfill-all");

if (!site) {
  usage();
  process.exit(1);
}

if (!sinceRef && !backfillAll) {
  console.error(
    "Refusing to backfill without a boundary. Pass --since-ref <commit> to protect recent edits, or --backfill-all for an intentional full hash migration.",
  );
  usage();
  process.exit(1);
}

if (sinceRef && backfillAll) {
  console.error("Use either --since-ref or --backfill-all, not both.");
  process.exit(1);
}

const config = loadConfig(site);
const token = loadPublishToken(site);
const documents = readVaultDocuments(config.vaultPath);
const docsBySlug = new Map(documents.map((doc) => [doc.slug, doc]));

const skipSlugs = new Set(readFlags(args, "--skip-slug"));
if (sinceRef) {
  const changed = changedSlugsSinceRef(config.vaultPath, sinceRef);
  for (const slug of changed.slugs) skipSlugs.add(slug);
  console.log(`Vault git root: ${changed.vaultGitRoot}`);
  console.log(`Vault pathspec: ${changed.vaultRel}`);
  console.log(`Skipping ${skipSlugs.size} slugs touched since ${sinceRef}.`);
} else {
  console.log(`Skipping ${skipSlugs.size} explicitly protected slugs.`);
}

const begin = (await post(`${config.publishUrl}/begin`, token, {
  siteSlug: config.site,
  hashFunctionVersion: HASH_FUNCTION_VERSION,
  manifest: {
    documents: documents.map(({ slug, hash, sensitive }) => ({
      slug,
      hash,
      sensitive,
    })),
    assets: [],
  },
  force: false,
  dryRun: true,
})) as BeginResponse;

const staleHashVersionSlugs = begin.staleHashVersionSlugs ?? [];
const staleSet = new Set(staleHashVersionSlugs);
const otherChanged = begin.missingDocumentSlugs.filter(
  (slug) => !staleSet.has(slug),
);
const backfillDocs: PublishDocument[] = [];
let skippedTouched = 0;
let missingLocal = 0;

for (const slug of staleHashVersionSlugs) {
  if (skipSlugs.has(slug)) {
    skippedTouched++;
    continue;
  }
  const doc = docsBySlug.get(slug);
  if (!doc) {
    missingLocal++;
    continue;
  }
  backfillDocs.push(doc);
}

console.log(
  `${backfillDocs.length} document hashes can be backfilled; ${skippedTouched} touched slugs skipped; ${missingLocal} missing local rows.`,
);
if (otherChanged.length > 0) {
  console.log(`${otherChanged.length} changed documents are not hash-version-only.`);
}

if (dryRun || backfillDocs.length === 0) {
  process.exit(0);
}

const result = await backfillDocumentHashes(
  config.publishUrl,
  token,
  config.site,
  backfillDocs,
);
console.log(
  `Backfilled ${result.patched} document hashes (${result.alreadyMatching} already matching, ${result.missing} missing rows).`,
);
