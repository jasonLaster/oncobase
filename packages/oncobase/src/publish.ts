#!/usr/bin/env node
import fs from "node:fs";
import { sitePut } from "./blob";
import { countEmbeddingTokens, embedBatch } from "./embeddings";
import { hasFlag, readFlag } from "./cli";
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
import { PUBLISHER_PROTOCOL_VERSION, PUBLISHER_VERSION_HEADER } from "./version";
import { readErrorBody } from "./http";
import { ensureCleanVault } from "./working-tree";

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

// Assets go directly to Vercel Blob from the publisher (the function
// is metadata-only), so the cap here is just RAM headroom for
// fs.readFileSync. Stream the body if outliers exceed this.
const MAX_ASSET_BYTES = 200 * 1024 * 1024;
const SKIPPED_ASSET_LOG = ".skipped-assets.txt";
// Doc POSTs are small JSON; asset uploads are up to 24MB and bandwidth-bound.
// Keep env overrides so operators can back off during large generated batches
// or transient Convex/Cloudflare instability without editing the script.
const DOC_CONCURRENCY = readPositiveIntEnv("PUBLISH_DOC_CONCURRENCY", 16);
const ASSET_CONCURRENCY = readPositiveIntEnv("PUBLISH_ASSET_CONCURRENCY", 6);
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
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        await worker(items[i], i);
      }
    })(),
  );
  await Promise.all(runners);
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
) {
  // Upload bytes directly to Vercel Blob (bypasses the function body
  // size cap), then POST metadata-only so Convex registers the URL.
  const body = fs.readFileSync(asset.filePath);
  const blob = await sitePut(siteSlug, `${asset.kind}s/${asset.relativePath}`, body, {
    contentType: asset.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  const response = await fetch(assetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      siteSlug,
      assetPath: asset.relativePath,
      kind: asset.kind,
      contentHash: asset.hash,
      blobUrl: blob.url,
      sizeBytes: asset.sizeBytes,
    }),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function backfillAssetHashes(
  publishUrl: string,
  token: string,
  siteSlug: string,
  assets: PublishAsset[],
) {
  let patched = 0;
  let missing = 0;
  for (let i = 0; i < assets.length; i += 500) {
    const batch = assets.slice(i, i + 500);
    const result = (await post(`${publishUrl}/asset-hashes`, token, {
      siteSlug,
      entries: batch.map((asset) => ({
        path: asset.relativePath,
        kind: asset.kind,
        contentHash: asset.hash,
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
  const tokenCounts = docs.map((doc) => countEmbeddingTokens(doc.content));
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

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
const dryRun = hasFlag(args, "--dry-run");
const force = hasFlag(args, "--force");
const confirmFullRepublish = hasFlag(args, "--confirm-full-republish");
const confirmLargeAssetUpload = hasFlag(args, "--confirm-large-asset-upload");
const confirmTombstone = hasFlag(args, "--confirm-tombstone") || force;
const syncFirst = hasFlag(args, "--sync-first");
const noSyncPreflight = hasFlag(args, "--no-sync-preflight");
const allowDirty = hasFlag(args, "--allow-dirty");

if (!site) {
  console.error(
    "Usage: oncobase publish --site <slug> [--dry-run] [--force --confirm-full-republish] [--confirm-large-asset-upload] [--confirm-tombstone] [--sync-first] [--no-sync-preflight] [--allow-dirty]",
  );
  process.exit(1);
}

if (force && !dryRun && !confirmFullRepublish) {
  console.error(
    "--force republishes every document and asset. Re-run with --confirm-full-republish if you really want to rebuild the world.",
  );
  process.exit(1);
}

const config = loadConfig(site);
const token = loadPublishToken(site);
ensureCleanVault(config.vaultPath, { allowDirty });

const shouldRunSyncPreflight = syncFirst || !noSyncPreflight;
if (shouldRunSyncPreflight) {
  const { runSync } = await import("./sync");
  const syncResult = await runSync({ site });
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

const documents = readVaultDocuments(config.vaultPath);
const assets = readVaultAssets(config.vaultPath);

const begin = (await post(`${config.publishUrl}/begin`, token, {
  siteSlug: config.site,
  hashFunctionVersion: HASH_FUNCTION_VERSION,
  manifest: {
    documents: documents.map(({ slug, hash, sensitive }) => ({
      slug,
      hash,
      sensitive,
    })),
    assets: assets.map(({ relativePath, hash, kind }) => ({
      path: relativePath,
      hash,
      kind,
    })),
  },
  force,
  dryRun,
})) as {
  runId: string;
  missingDocumentSlugs: string[];
  missingAssetPaths: string[];
  staleDocumentSlugs?: string[];
  staleAssetPaths?: string[];
  staleHashVersionSlugs?: string[];
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
  await post(`${config.publishUrl}/abort`, token, {
    siteSlug: config.site,
    error: reason,
  }).catch((error) => {
    console.warn(
      `  failed to release publish lock: ${(error as Error).message}`,
    );
  });
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
      hashMismatch: 0,
      forced: 0,
    },
  );
}

function printAssetChangeBreakdown(assetChanges: AssetChange[]) {
  const counts = assetChangeCounts(assetChanges);
  console.log(
    `  asset diff: ${counts.missingRemoteAssetRow} missing rows, ${counts.missingRemoteContentHash} metadata-only hash backfills, ${counts.hashMismatch} hash mismatches, ${counts.forced} forced`,
  );
}

function assetKey(kind: "pdf" | "file", path: string) {
  return `${kind}:${path}`;
}

const changedDocs = force
  ? documents
  : documents.filter((doc) => begin.missingDocumentSlugs.includes(doc.slug));
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
    .filter((asset) => asset.reason !== "missingRemoteContentHash")
    .map((asset) => assetKey(asset.kind, asset.path)),
);
const changedAssets = force
  ? assets
  : begin.assetChanges
    ? assets.filter((asset) =>
        uploadAssetKeys.has(assetKey(asset.kind, asset.relativePath)),
      )
    : assets.filter((asset) => missingAssetPathSet.has(asset.relativePath));
const hashBackfillAssets = assetChanges
  .filter((asset) => asset.reason === "missingRemoteContentHash")
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
  console.log(
    `Dry run: ${changedDocs.length} documents changed, ${changedAssets.length} assets need upload, ${hashBackfillAssets.length} asset hashes need metadata-only backfill, ${
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
  changedDocs.length <= LARGE_ASSET_UPLOAD_DOC_LIMIT
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

if (hashBackfillAssets.length > 0) {
  const result = await backfillAssetHashes(
    config.publishUrl,
    token,
    config.site,
    hashBackfillAssets,
  );
  console.log(
    `  backfilled ${result.patched}/${hashBackfillAssets.length} asset hashes without uploading bytes${
      result.missing ? ` (${result.missing} rows missing)` : ""
    }`,
  );
}

const doEmbed = Boolean(process.env.OPENAI_API_KEY) && changedDocs.length > 0;
const embeddings = doEmbed
  ? await embedInChunks(changedDocs)
  : new Array<undefined>(changedDocs.length).fill(undefined);

let docsDone = 0;
await runWithConcurrency(changedDocs, DOC_CONCURRENCY, async (doc, i) => {
  await post(`${config.publishUrl}/document`, token, {
    runId: begin.runId,
    siteSlug: config.site,
    ...doc,
    hashFunctionVersion: HASH_FUNCTION_VERSION,
    embedding: embeddings[i],
  });
  docsDone++;
  if (docsDone % 100 === 0) {
    console.log(`  ${docsDone}/${changedDocs.length} documents`);
  }
});

const skipped: PublishAsset[] = [];
let uploaded = 0;
await runWithConcurrency(changedAssets, ASSET_CONCURRENCY, async (asset) => {
  if (asset.sizeBytes > MAX_ASSET_BYTES) {
    skipped.push(asset);
    return;
  }
  try {
    await uploadAsset(`${config.publishUrl}/asset`, token, config.site, asset);
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
});

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
}

await post(`${config.publishUrl}/finish`, token, {
  runId: begin.runId,
  siteSlug: config.site,
  deletedDocSlugs: begin.staleDocumentSlugs ?? [],
  deletedAssetPaths: begin.staleAssetPaths ?? [],
});
lockHeld = false; // /finish releases the lock; don't double-abort.

const tombstonedDocSlugs = begin.staleDocumentSlugs ?? [];
const tombstonedAssetPaths = begin.staleAssetPaths ?? [];
console.log(
  `Published ${changedDocs.length} documents, uploaded ${uploaded} assets, backfilled ${hashBackfillAssets.length} asset hashes, tombstoned ${
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
