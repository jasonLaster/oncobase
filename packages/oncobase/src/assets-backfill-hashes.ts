#!/usr/bin/env node
import { hasFlag, readFlag } from "./cli";
import { loadConfig, loadPublishToken } from "./config";
import { readErrorBody } from "./http";
import { HASH_FUNCTION_VERSION, readVaultAssets, type PublishAsset } from "./walk-vault";
import { PUBLISHER_PROTOCOL_VERSION, PUBLISHER_VERSION_HEADER } from "./version";

type AssetChange = {
  path: string;
  kind: "pdf" | "file";
  reason:
    | "missingRemoteAssetRow"
    | "missingRemoteContentHash"
    | "hashMismatch"
    | "forced";
};

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

async function backfillAssetHashes(
  publishUrl: string,
  token: string,
  siteSlug: string,
  assets: PublishAsset[],
) {
  let patched = 0;
  let unchanged = 0;
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
    })) as { patched?: number; unchanged?: number; missing?: string[] };
    patched += result.patched ?? 0;
    unchanged += result.unchanged ?? 0;
    missing += result.missing?.length ?? 0;
  }
  return { patched, unchanged, missing };
}

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
const dryRun = hasFlag(args, "--dry-run");

if (!site) {
  console.error("Usage: oncobase assets:backfill-hashes --site <slug> [--dry-run]");
  process.exit(1);
}

const config = loadConfig(site);
const token = loadPublishToken(site);
const assets = readVaultAssets(config.vaultPath);
const assetsByKey = new Map(
  assets.map((asset) => [`${asset.kind}:${asset.relativePath}`, asset]),
);

const begin = (await post(`${config.publishUrl}/begin`, token, {
  siteSlug: config.site,
  hashFunctionVersion: HASH_FUNCTION_VERSION,
  manifest: {
    documents: [],
    assets: assets.map(({ relativePath, hash, kind }) => ({
      path: relativePath,
      hash,
      kind,
    })),
  },
  force: false,
  dryRun: true,
})) as { assetChanges?: AssetChange[] };

if (!begin.assetChanges) {
  throw new Error(
    "Publish server did not return asset diff categories. Deploy the updated web app first.",
  );
}

const backfillAssets = begin.assetChanges
  .filter((asset) => asset.reason === "missingRemoteContentHash")
  .map((asset) => assetsByKey.get(`${asset.kind}:${asset.path}`))
  .filter((asset): asset is PublishAsset => Boolean(asset));

const uploadRequired = begin.assetChanges.length - backfillAssets.length;
console.log(
  `${backfillAssets.length} asset hashes can be backfilled without uploading bytes; ${uploadRequired} assets still require upload.`,
);

if (dryRun || backfillAssets.length === 0) {
  process.exit(0);
}

const result = await backfillAssetHashes(
  config.publishUrl,
  token,
  config.site,
  backfillAssets,
);
console.log(
  `Backfilled ${result.patched} asset hashes (${result.unchanged} unchanged, ${result.missing} missing rows).`,
);
