#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { sitePut } from "./blob";
import { countEmbeddingTokens, embedBatch } from "./embeddings";
import { parseArgs } from "node:util";
import { readPublishScope, readPublishSelection, type AssetMode } from "./publish-scope";
import { readPublishedState, comparePublishedState } from "./publish-state";
import { loadConfig, loadPublishToken } from "./config";
import {
  readPositiveIntEnv,
  retryRateLimited,
  RetryCooldown,
  TokenWindow,
} from "./rate-limit";
import {
  HASH_FUNCTION_VERSION,
  readVaultAssets,
  readVaultDocuments,
  type PublishAsset,
  type PublishDocument,
} from "./walk-vault";
import { ensureCleanVault } from "./working-tree";
import { publisherPost } from "./publish-post";
import { installPublishProfile, publishProfile } from "./publish-profile";

const post = <T = unknown>(url: string, token: string, body: unknown, timeoutMs = requestTimeoutMs) => publisherPost<T>(url, token, body, {
  signal: AbortSignal.timeout(timeoutMs),
});

// Assets go directly to Vercel Blob from the publisher (the function
// is metadata-only), so the cap here is just RAM headroom for
// fs.readFileSync. Stream the body if outliers exceed this.
const MAX_ASSET_BYTES =
  readPositiveIntEnv("PUBLISH_MAX_ASSET_MB", 1024) * 1024 * 1024;
const SKIPPED_ASSET_LOG = ".skipped-assets.txt";
// Doc POSTs are small JSON; asset uploads are up to 24MB and bandwidth-bound.
// Keep env overrides so operators can back off during large generated batches
// or transient Convex/Cloudflare instability without editing the script.
const LARGE_ASSET_UPLOAD_THRESHOLD = readPositiveIntEnv(
  "PUBLISH_LARGE_ASSET_UPLOAD_THRESHOLD",
  100,
);
const LARGE_ASSET_UPLOAD_DOC_LIMIT = readPositiveIntEnv(
  "PUBLISH_LARGE_ASSET_UPLOAD_DOC_LIMIT",
  10,
);

type AssetChangeReason =
  | "missingRemoteAssetRow"
  | "missingRemoteContentHash"
  | "missingRemoteBlob"
  | "unverifiedRemoteBytes"
  | "metadataMismatch"
  | "hashMismatch"
  | "forced";

type AssetChange = {
  path: string;
  kind: "pdf" | "file";
  reason: AssetChangeReason;
};

type AssetChangeCounts = Record<AssetChangeReason, number>;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  let failed = false;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (true) {
        if (failed) return;
        const i = next++;
        if (i >= items.length) return;
        try { await worker(items[i], i); }
        catch (error) { failed = true; throw error; }
      }
    })(),
  );
  const results = await Promise.allSettled(runners);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}
// embed() in src/lib/embeddings handles chunking + pooling per doc.
// Parallelize at the doc level instead of OpenAI's request-batching
// since long docs need their own multi-chunk request anyway.
const EMBED_CONCURRENCY = readPositiveIntEnv("PUBLISH_EMBED_CONCURRENCY", 8);
const EMBED_TOKENS_PER_MINUTE = readPositiveIntEnv(
  "PUBLISH_EMBED_TPM",
  4_500_000,
);
const EMBED_MAX_ATTEMPTS = readPositiveIntEnv("PUBLISH_EMBED_MAX_ATTEMPTS", 12);

async function uploadAsset(
  assetUrl: string,
  token: string,
  siteSlug: string,
  asset: PublishAsset,
  runId: string,
) {
  // Upload bytes directly to Vercel Blob (bypasses the function body
  // size cap), then POST metadata-only so Convex registers the URL.
  const body = publishProfile.sync("asset.read", () => fs.readFileSync(asset.filePath));
  if (createHash("sha256").update(body).digest("hex").slice(0, 16) !== asset.hash) throw new Error("Asset changed after planning; refusing to upload mismatched bytes");
  const key = runId.startsWith("scoped:") ? `${asset.kind}s/${asset.hash}/${asset.relativePath}` : `${asset.kind}s/${asset.relativePath}`;
  const blob = await publishProfile.span("asset.blob", () => sitePut(siteSlug, key, body, {
    contentType: asset.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  }));
  if (runId.startsWith("scoped:")) {
    await publishProfile.span("asset.verify", async () => {
      const response = await fetch(blob.url, { signal: AbortSignal.timeout(requestTimeoutMs), cache: "no-store" });
      if (!response.ok || !response.body) throw new Error(`Uploaded asset read-back failed (${response.status})`);
      const digest = createHash("sha256");
      let bytes = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { digest.update(chunk); bytes += chunk.byteLength; }
      publishProfile.metric("bytes", bytes);
      if (bytes !== asset.sizeBytes || digest.digest("hex").slice(0, 16) !== asset.hash) throw new Error("Uploaded asset failed byte verification");
    });
  }
  return await post(assetUrl, token, {
    runId, siteSlug, assetPath: asset.relativePath, kind: asset.kind,
    contentHash: asset.hash, blobUrl: blob.url, sizeBytes: asset.sizeBytes,
    ownerSlugs: asset.ownerSlugs, sensitive: asset.sensitive,
    sensitiveInclude: asset.sensitiveInclude, visibilityHash: asset.visibilityHash,
  });
}

async function backfillAssetHashes(
  publishUrl: string,
  token: string,
  siteSlug: string,
  assets: PublishAsset[],
  runId: string,
) {
  let patched = 0;
  let missing = 0;
  for (let i = 0; i < assets.length; i += 500) {
    const batch = assets.slice(i, i + 500);
    const result = (await post(`${publishUrl}/asset-hashes`, token, {
      runId, siteSlug,
      entries: batch.map((asset) => ({
        path: asset.relativePath,
        kind: asset.kind,
        contentHash: asset.hash,
        ownerSlugs: asset.ownerSlugs,
        sensitive: asset.sensitive,
        sensitiveInclude: asset.sensitiveInclude,
        visibilityHash: asset.visibilityHash,
      })),
    })) as { patched?: number; missing?: string[] };
    patched += result.patched ?? 0;
    missing += result.missing?.length ?? 0;
  }
  return { patched, missing };
}

async function embedInChunks(
  docs: PublishDocument[],
): Promise<(number[] | undefined)[]> {
  const out: (number[] | undefined)[] = new Array(docs.length).fill(undefined);
  const tokenWindow = new TokenWindow(EMBED_TOKENS_PER_MINUTE);
  const cooldown = new RetryCooldown();
  const tokenCounts = publishProfile.sync("embeddings.tokens", () => docs.map((doc) => countEmbeddingTokens(doc.content)));
  let done = 0;

  console.log(
    `  embedding ${docs.length} documents with concurrency ${EMBED_CONCURRENCY}, TPM cap ${EMBED_TOKENS_PER_MINUTE}`,
  );

  await runWithConcurrency(docs, EMBED_CONCURRENCY, async (doc, i) => {
    try {
      const [vec] = await retryRateLimited(
        () => embedBatch([doc.content]),
        {
          label: doc.slug,
          maxAttempts: EMBED_MAX_ATTEMPTS,
          cooldown,
          reserveTokens: () => tokenWindow.reserve(tokenCounts[i]),
          onRetry: (message) => console.warn(message),
        },
      );
      out[i] = vec;
    } catch (error) {
      throw new Error(
        `embedding failed for ${doc.slug}: ${(error as Error).message}`,
      );
    }
    done++;
    if (done % 100 === 0) {
      console.log(`  ${done}/${docs.length} embeddings`);
    }
  });
  return out;
}

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  site: { type: "string" }, vault: { type: "string" }, profile: { type: "string" }, "no-profile": { type: "boolean" }, "files-from": { type: "string" },
  "doc-concurrency": { type: "string" }, "asset-concurrency": { type: "string" }, "request-timeout-ms": { type: "string", default: "20000" },
  assets: { type: "string" }, embeddings: { type: "string", default: "auto" }, verify: { type: "string" },
  "dry-run": { type: "boolean" }, force: { type: "boolean" }, "confirm-full-republish": { type: "boolean" },
  "confirm-large-asset-upload": { type: "boolean" }, "confirm-tombstone": { type: "boolean" },
  "sync-first": { type: "boolean" }, "no-sync-preflight": { type: "boolean" }, "allow-dirty": { type: "boolean" },
  help: { type: "boolean" },
} });
function positiveOption(value: string | undefined, fallback: number, maximum: number, name: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  return parsed;
}
const DOC_CONCURRENCY = positiveOption(values["doc-concurrency"], readPositiveIntEnv("PUBLISH_DOC_CONCURRENCY", 16), 32, "--doc-concurrency");
const ASSET_CONCURRENCY = positiveOption(values["asset-concurrency"], readPositiveIntEnv("PUBLISH_ASSET_CONCURRENCY", 6), 16, "--asset-concurrency");
const requestTimeoutMs = positiveOption(values["request-timeout-ms"], 20_000, 300_000, "--request-timeout-ms");
if (values.profile && values["no-profile"]) throw new Error("--profile conflicts with --no-profile");
let profilePath = values["no-profile"] ? undefined : values.profile ?? process.env.PUBLISH_PROFILE;
if (!values["no-profile"] && !profilePath && values.site && !values.help) {
  const directory = path.join(os.homedir(), ".config", "wiki", "publish-profiles");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  profilePath = path.join(directory, `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`);
}
if (profilePath) {
  installPublishProfile(profilePath);
  console.log(`Publish profile: ${profilePath}`);
}
const site = values.site;
const dryRun = values["dry-run"] ?? false;
const force = values.force ?? false;
const confirmFullRepublish = values["confirm-full-republish"];
const confirmLargeAssetUpload = values["confirm-large-asset-upload"];
const confirmTombstone = values["confirm-tombstone"] || force;
const syncFirst = values["sync-first"];
const noSyncPreflight = values["no-sync-preflight"];
const allowDirty = values["allow-dirty"];
const scope = values["files-from"] ? readPublishScope(values["files-from"]) : undefined;
const assetMode = values.assets ?? (scope ? "referenced" : "all");
const verification = values.verify ?? (scope ? "content" : "legacy");
if (!site || values.help) {
  console.log(`Usage: oncobase publish --site <slug> [options]
  --vault <path>                Publish a release worktree without changing saved site config
  --files-from <scope.json>       Selected vault-relative Markdown paths; never infer deletions
  --assets none|referenced|all   Scoped default: referenced; whole-vault default: all
  --embeddings auto|skip|required  Auto requires OPENAI_API_KEY; skip leaves search vectors unchanged
  --verify content|metadata      Scoped default: content; metadata trusts stored content hashes
  --dry-run                     Read-only plan; no sync, locks, embeddings, or uploads
  --profile <new-file.json>      Override automatic private timing profile under ~/.config/wiki/publish-profiles
  --no-profile                  Explicitly disable local profiling
  --doc-concurrency <1..32>      Document workers (default 16, or PUBLISH_DOC_CONCURRENCY)
  --asset-concurrency <1..16>    Asset workers (default 6, or PUBLISH_ASSET_CONCURRENCY)
  --request-timeout-ms <ms>      Per API request timeout (default 20000); writes are not blindly retried
  --sync-first                  Pull remote changes before a real publish
  --no-sync-preflight            Skip the whole-vault default sync (scoped publishes skip it by default)
  --allow-dirty                 Allow an uncommitted local vault
  --force --confirm-full-republish | --confirm-large-asset-upload | --confirm-tombstone`);
  process.exit(values.help ? 0 : 1);
}
if (!["none", "referenced", "all"].includes(assetMode) || (!scope && assetMode !== "all")) throw new Error("--assets none|referenced requires --files-from");
if (!["auto", "skip", "required"].includes(values.embeddings)) throw new Error("--embeddings must be auto, skip, or required");
if (!["content", "metadata", "legacy"].includes(verification) || values.verify === "legacy") throw new Error("--verify must be content or metadata");
if (syncFirst && noSyncPreflight) throw new Error("--sync-first conflicts with --no-sync-preflight");
if (dryRun && syncFirst) throw new Error("--dry-run cannot pull files; run sync separately");
if (scope && values["confirm-tombstone"]) throw new Error("Scoped publishes never infer tombstones");

if (force && !dryRun && !confirmFullRepublish) {
  console.error(
    "--force republishes every document and asset. Re-run with --confirm-full-republish if you really want to rebuild the world.",
  );
  process.exit(1);
}

const config = publishProfile.sync("config", () => {
  const config = loadConfig(site);
  return { ...config, vaultPath: values.vault ? path.resolve(values.vault) : config.vaultPath };
});
const token = loadPublishToken(site);
publishProfile.sync("git.check", () => ensureCleanVault(config.vaultPath, { allowDirty }));

const shouldRunSyncPreflight = !dryRun && (syncFirst || (!scope && !noSyncPreflight));
if (shouldRunSyncPreflight) {
  const { runSync } = await import("./sync");
  const syncResult = await publishProfile.span("sync", () => runSync({ site, vaultPath: config.vaultPath }));
  if (syncResult.reviewed > 0 || syncResult.skippedAssets.length > 0) {
    const reasons: string[] = [];
    if (syncResult.reviewed > 0) {
      reasons.push(`${syncResult.reviewed} conflicting remote files copied to review`);
    }
    if (syncResult.skippedAssets.length > 0) {
      reasons.push(`${syncResult.skippedAssets.length} remote assets skipped during sync`);
    }
    console.error(`Sync preflight found issues: ${reasons.join("; ")}.`);
    if (syncResult.reviewDir) {
      console.error(`Resolve review items in ${syncResult.reviewDir} before publishing.`);
    }
    process.exit(1);
  }
}

if (values.embeddings === "required" && !process.env.OPENAI_API_KEY) throw new Error("--embeddings required needs OPENAI_API_KEY");
console.log(`Publish policy: scope=${scope ? "selected" : "whole-vault"}, assets=${assetMode}, sync=${shouldRunSyncPreflight ? "pull" : "none"}, embeddings=${values.embeddings}, verify=${verification}.`);
const selected = scope ? readPublishSelection(config.vaultPath, scope, assetMode as AssetMode) : undefined;
const documents = selected?.documents ?? publishProfile.sync("scan.documents", () => {
  const docs = readVaultDocuments(config.vaultPath);
  publishProfile.metric("items", docs.length);
  return docs;
});
const assets = selected?.assets ?? publishProfile.sync("scan.assets", () => {
  const assets = readVaultAssets(config.vaultPath);
  publishProfile.metric("items", assets.length);
  publishProfile.metric("bytes", assets.reduce((n, a) => n + a.sizeBytes, 0));
  return assets;
});

if (scope && (documents.length > 1000 || assets.length > 1024)) throw new Error("Scoped publish supports at most 1000 documents and 1024 assets; narrow the scope");
const requestedRunId = scope ? `scoped:${randomUUID()}` : undefined;
const begin = (await post(`${config.publishUrl}/${scope ? "scoped/begin" : "begin"}`, token, {
  runId: requestedRunId,
  siteSlug: config.site,
  hashFunctionVersion: HASH_FUNCTION_VERSION,
  manifest: {
    documents: documents.map(({ slug, hash, sensitive }) => ({
      slug,
      hash,
      sensitive,
    })),
    assets: assets.map(
      ({
        relativePath,
        hash,
        kind,
        visibilityHash,
      }) => ({
        path: relativePath,
        hash,
        kind,
        visibilityHash,
      }),
    ),
  },
  force,
  dryRun,
  verification,
}).catch(async error => {
  if (requestedRunId && !dryRun) {
    await post(`${config.publishUrl}/scoped/abort`, token, { siteSlug: config.site, runId: requestedRunId, error: "Begin failed or timed out" }).catch(() => {});
  }
  throw error;
})) as {
  runId: string;
  scoped?: boolean;
  missingDocumentSlugs: string[];
  missingAssetPaths: string[];
  staleDocumentSlugs?: string[];
  staleAssetPaths?: string[];
  staleHashVersionSlugs?: string[];
  rawContentBackfillSlugs?: string[];
  assetChanges?: AssetChange[];
};


const staleHashVersionCount = begin.staleHashVersionSlugs?.length ?? 0;
if (staleHashVersionCount > 0) {
  console.log(
    `  ${staleHashVersionCount} of the changed documents differ only by hash format — run ` +
      `the operator content-hash backfill for ${config.site} ` +
      `to migrate hashes without re-uploading content (and embeddings).`,
  );
}

// /begin acquires the publish lock for 10 minutes (unless dryRun).
// Anything thrown between here and the /finish call must release
// the lock via /abort, otherwise the next publisher gets "publish
// already running" and an operator has to clear it manually. Track
// whether we still own the lock and ensure the abort fires once.
let lockHeld = !dryRun;
async function abortIfHolding(reason: string) {
  if (!lockHeld) return;
  lockHeld = false;
  await post(`${config.publishUrl}/${scope ? "scoped/abort" : "abort"}`, token, {
    siteSlug: config.site,
    runId: begin.runId,
    error: reason,
  }).catch((error) => {
    console.warn(
      `  failed to release publish lock: ${(error as Error).message}`,
    );
  });
}
if (scope && (begin.scoped !== true || begin.runId !== requestedRunId || begin.staleDocumentSlugs?.length || begin.staleAssetPaths?.length)) {
  await abortIfHolding("Server did not acknowledge scoped publish");
  throw new Error("Server did not acknowledge a safe scoped publish; update the server before retrying");
}

function abortOnSignal(signal: NodeJS.Signals) {
  abortIfHolding(`publisher received ${signal}`).finally(() => {
    process.exit(130);
  });
}
process.once("SIGINT", abortOnSignal);
process.once("SIGTERM", abortOnSignal);

function assetChangeCounts(assetChanges: AssetChange[]): AssetChangeCounts {
  return assetChanges.reduce<AssetChangeCounts>(
    (counts, change) => {
      counts[change.reason]++;
      return counts;
    },
    {
      missingRemoteAssetRow: 0,
      missingRemoteContentHash: 0,
      missingRemoteBlob: 0,
      unverifiedRemoteBytes: 0,
      metadataMismatch: 0,
      hashMismatch: 0,
      forced: 0,
    },
  );
}

function printAssetChangeBreakdown(assetChanges: AssetChange[]) {
  const counts = assetChangeCounts(assetChanges);
  console.log(
    `  asset diff: ${counts.missingRemoteAssetRow} missing rows, ${counts.missingRemoteBlob} missing blob URLs, ${counts.unverifiedRemoteBytes} uploads to establish a verified hash, ${counts.missingRemoteContentHash} metadata-only hash backfills, ${counts.metadataMismatch} visibility metadata changes, ${counts.hashMismatch} hash mismatches, ${counts.forced} forced`,
  );
}

function assetKey(kind: "pdf" | "file", path: string) {
  return `${kind}:${path}`;
}

const changedDocs = force
  ? documents
  : documents.filter((doc) => begin.missingDocumentSlugs.includes(doc.slug));
const rawContentBackfillSlugSet = new Set(begin.rawContentBackfillSlugs ?? []);
const assetsByKey = new Map(
  assets.map((asset) => [
    assetKey(asset.kind, asset.relativePath),
    asset,
  ]),
);
const assetChanges =
  begin.assetChanges ??
  begin.missingAssetPaths.map((path) => ({
    path,
    kind: "file" as const,
    reason: "hashMismatch" as const,
  }));
const missingAssetPathSet = new Set(begin.missingAssetPaths);
const uploadAssetKeys = new Set(
  assetChanges
    .filter(
      (asset) =>
        asset.reason !== "missingRemoteContentHash" &&
        asset.reason !== "metadataMismatch",
    )
    .map((asset) => assetKey(asset.kind, asset.path)),
);
const changedAssets = force
  ? assets
  : begin.assetChanges
    ? assets.filter((asset) =>
        uploadAssetKeys.has(assetKey(asset.kind, asset.relativePath)),
      )
    : assets.filter((asset) => missingAssetPathSet.has(asset.relativePath));
const metadataBackfillAssets = assetChanges
  .filter(
    (asset) =>
      asset.reason === "missingRemoteContentHash" ||
      asset.reason === "metadataMismatch",
  )
  .map((asset) => assetsByKey.get(assetKey(asset.kind, asset.path)))
  .filter((asset): asset is PublishAsset => Boolean(asset));

printAssetChangeBreakdown(assetChanges);

const staleDocCount = begin.staleDocumentSlugs?.length ?? 0;
const staleAssetCount = begin.staleAssetPaths?.length ?? 0;
if (!dryRun && !confirmTombstone && (staleDocCount > 0 || staleAssetCount > 0)) {
  console.error(
    `Remote has ${staleDocCount} documents and ${staleAssetCount} assets not present locally.`,
  );
  if (begin.staleDocumentSlugs?.length) {
    console.error(`Documents: ${begin.staleDocumentSlugs.slice(0, 20).join(", ")}${begin.staleDocumentSlugs.length > 20 ? ", ..." : ""}`);
  }
  if (begin.staleAssetPaths?.length) {
    console.error(`Assets: ${begin.staleAssetPaths.slice(0, 20).join(", ")}${begin.staleAssetPaths.length > 20 ? ", ..." : ""}`);
  }
  console.error("Re-run with --confirm-tombstone to delete these remote rows, --sync-first to fetch missing local files first, or --force to force the full publish.");
  await abortIfHolding("aborted: stale remote rows; rerun with --confirm-tombstone");
  process.exit(1);
}

if (dryRun) {
  const rawContentBackfillCount = begin.rawContentBackfillSlugs?.length ?? 0;
  console.log(
    `Dry run: ${changedDocs.length} documents changed (${rawContentBackfillCount} raw-content backfills), ${changedAssets.length} assets need upload, ${metadataBackfillAssets.length} asset rows need metadata-only backfill, ${
      begin.staleDocumentSlugs?.length ?? 0
    } documents stale, ${begin.staleAssetPaths?.length ?? 0} assets stale`,
  );
  process.exit(0);
}

try {
if (
  !force &&
  !confirmLargeAssetUpload &&
  changedAssets.length > LARGE_ASSET_UPLOAD_THRESHOLD &&
  (scope || changedDocs.length <= LARGE_ASSET_UPLOAD_DOC_LIMIT)
) {
  console.error(
    `Publish wants to upload ${changedAssets.length} assets while only ${changedDocs.length} documents changed.`,
  );
  console.error(
    "Review the asset diff above, then re-run with --confirm-large-asset-upload if the byte upload is intentional.",
  );
  await abortIfHolding("aborted: large asset upload requires confirmation");
  process.exit(1);
}

if (metadataBackfillAssets.length > 0) {
  const result = await publishProfile.span("metadata", () => backfillAssetHashes(
    config.publishUrl,
    token,
    config.site,
    metadataBackfillAssets,
    begin.runId,
  ));
  if (result.missing) throw new Error(`${result.missing} asset rows missing during metadata backfill`);
  console.log(
    `  backfilled ${result.patched}/${metadataBackfillAssets.length} asset rows without uploading bytes${
      result.missing ? ` (${result.missing} rows missing)` : ""
    }`,
  );
}

const docsToEmbed = changedDocs.filter(
  (doc) => !rawContentBackfillSlugSet.has(doc.slug),
);
const doEmbed = values.embeddings !== "skip" && Boolean(process.env.OPENAI_API_KEY) && docsToEmbed.length > 0;
if (docsToEmbed.length && !doEmbed) console.log(`  embeddings skipped (${values.embeddings === "skip" ? "explicit policy" : "OPENAI_API_KEY unavailable"}); existing search vectors may be stale.`);
const embeddingsBySlug = new Map<string, number[] | undefined>();
if (doEmbed) {
  const embeddings = await publishProfile.span("embeddings", () => embedInChunks(docsToEmbed));
  docsToEmbed.forEach((doc, index) => {
    embeddingsBySlug.set(doc.slug, embeddings[index]);
  });
}

let docsDone = 0;
await publishProfile.span("upload.documents", () => runWithConcurrency(changedDocs, DOC_CONCURRENCY, async (doc) => {
  await post(`${config.publishUrl}/document`, token, {
    runId: begin.runId,
    siteSlug: config.site,
    ...doc,
    hashFunctionVersion: HASH_FUNCTION_VERSION,
    embedding: embeddingsBySlug.get(doc.slug),
  });
  docsDone++;
  if (docsDone % 100 === 0) {
    console.log(`  ${docsDone}/${changedDocs.length} documents`);
  }
}));

const skipped: PublishAsset[] = [];
let uploaded = 0;
await publishProfile.span("upload.assets", () => runWithConcurrency(changedAssets, ASSET_CONCURRENCY, async (asset) => {
  if (asset.sizeBytes > MAX_ASSET_BYTES) {
    skipped.push(asset);
    return;
  }
  try {
    await uploadAsset(`${config.publishUrl}/asset`, token, config.site, asset, begin.runId);
    uploaded++;
    if (uploaded % 50 === 0) {
      console.log(`  ${uploaded}/${changedAssets.length} assets uploaded`);
    }
  } catch (error) {
    console.warn(
      `  asset ${asset.relativePath} failed: ${(error as Error).message}`,
    );
    skipped.push(asset);
  }
}));

if (skipped.length > 0) {
  fs.writeFileSync(
    SKIPPED_ASSET_LOG,
    `${skipped
      .map(
        (a) =>
          `${a.kind}\t${(a.sizeBytes / 1024 / 1024).toFixed(1)}MB\t${a.relativePath}`,
      )
      .join("\n")}\n`,
  );
  console.warn(
    `  ${skipped.length} assets exceeded ${(MAX_ASSET_BYTES / 1024 / 1024).toFixed(0)}MB or failed; logged to ${SKIPPED_ASSET_LOG}`,
  );
  throw new Error(`${skipped.length} assets were not published; refusing to report success`);
}

if (verification !== "legacy") {
  await publishProfile.span("verify.documents", async () => {
    const state = await readPublishedState({ ...config, token, slugs: documents.map(doc => doc.slug),
      assets: assets.map(asset => ({ path: asset.relativePath, kind: asset.kind })) });
    const mismatch = comparePublishedState(state, documents, assets, verification as "content" | "metadata");
    if (mismatch.documentMismatches.length || mismatch.assetMismatches.length) {
      throw new Error(`Verification failed: ${mismatch.documentMismatches.length} documents, ${mismatch.assetMismatches.length} assets. Content verification requires stored raw content; use --verify metadata only when that weaker check is intentional.`);
    }
    publishProfile.metric("items", documents.length + assets.length);
  });
}

const finished = await post<{ ok: boolean; revision?: number }>(`${config.publishUrl}/${scope ? "scoped/finish" : "finish"}`, token, {
  runId: begin.runId,
  siteSlug: config.site,
  changedDocumentSlugs: changedDocs.map((doc) => doc.slug),
  deletedDocSlugs: begin.staleDocumentSlugs ?? [],
  deletedAssetPaths: begin.staleAssetPaths ?? [],
});
lockHeld = false; // /finish releases the lock; don't double-abort.
if (scope) {
  if (!Number.isInteger(finished.revision)) throw new Error("Data committed, but server did not return a reader revision");
  await publishProfile.span("verify.reader", async () => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const readiness = await post<{ ready: boolean; documentMismatches?: number; assetMismatches?: number }>(`${config.publishUrl}/status`, token, {
        siteSlug: config.site, minimumRevision: finished.revision,
        documents: documents.map(({ slug, hash, sensitive }) => ({ slug, hash, sensitive })),
        assets: assets.map(({ relativePath, kind, hash, sensitive }) => ({ path: relativePath, kind, hash, sensitive })),
      }, Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now())));
      if (readiness.ready) return;
      if (readiness.documentMismatches || readiness.assetMismatches) throw new Error("Data committed, but the reader manifest differs from the selected publish scope");
      if (Date.now() >= deadline) throw new Error("Data committed, but reader readiness was not confirmed within 15 seconds");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }).catch(() => { throw new Error("Data committed, but reader readiness could not be confirmed; publication is not verified"); });
}

const tombstonedDocSlugs = begin.staleDocumentSlugs ?? [];
const tombstonedAssetPaths = begin.staleAssetPaths ?? [];
console.log(
  `Published ${changedDocs.length} documents, uploaded ${uploaded} assets, backfilled ${metadataBackfillAssets.length} asset rows, tombstoned ${
    tombstonedDocSlugs.length
  } documents and ${tombstonedAssetPaths.length} assets for ${config.site}.`,
);
if (tombstonedDocSlugs.length > 0) {
  console.log(`  Tombstoned documents: ${tombstonedDocSlugs.join(", ")}`);
}
if (tombstonedAssetPaths.length > 0) {
  console.log(`  Tombstoned assets: ${tombstonedAssetPaths.join(", ")}`);
}
} catch (error) {
  await abortIfHolding(
    error instanceof Error ? error.message : String(error),
  );
  throw error;
}
