#!/usr/bin/env node
import { loadConfig, loadPublishToken } from "./config";
import {
  HASH_FUNCTION_VERSION,
  readVaultAssets,
  readVaultDocuments,
} from "./walk-vault";
import { hasFlag, readFlag } from "./cli";
import { PUBLISHER_PROTOCOL_VERSION, PUBLISHER_VERSION_HEADER } from "./version";
import { readErrorBody } from "./http";
import { ensureCleanVault } from "./working-tree";

const site = readFlag(process.argv.slice(2), "--site");
if (!site) {
  console.error("Usage: oncobase check --site <slug>");
  process.exit(1);
}

const allowDirty = hasFlag(process.argv.slice(2), "--allow-dirty");

const config = loadConfig(site);
const token = loadPublishToken(site);
ensureCleanVault(config.vaultPath, { allowDirty });
const documents = readVaultDocuments(config.vaultPath);
const assets = readVaultAssets(config.vaultPath);

const response = await fetch(`${config.publishUrl}/begin`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    [PUBLISHER_VERSION_HEADER]: String(PUBLISHER_PROTOCOL_VERSION),
  },
  body: JSON.stringify({
    siteSlug: config.site,
    hashFunctionVersion: HASH_FUNCTION_VERSION,
    dryRun: true,
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
  }),
});

if (!response.ok) {
  if (response.status === 426) {
    console.error(await response.text());
    console.error("Update @oncobase/oncobase, then retry.");
    process.exit(1);
  }
  console.error(
    `Publish check failed: ${response.status} ${await readErrorBody(response)}`,
  );
  process.exit(1);
}

const result = (await response.json()) as {
  runId: string;
  missingDocumentSlugs: string[];
  missingAssetPaths: string[];
  staleDocumentSlugs?: string[];
  staleAssetPaths?: string[];
  staleHashVersionSlugs?: string[];
};

const staleDocs = result.staleDocumentSlugs ?? [];
const staleAssets = result.staleAssetPaths ?? [];
const staleHashVersion = result.staleHashVersionSlugs?.length ?? 0;

console.log(
  `Documents: ${result.missingDocumentSlugs.length} changed, ${
    documents.length - result.missingDocumentSlugs.length
  } unchanged`,
);
console.log(
  `Assets:    ${result.missingAssetPaths.length} changed, ${
    assets.length - result.missingAssetPaths.length
  } unchanged`,
);
console.log(
  `Stale:     ${staleDocs.length} documents, ${staleAssets.length} assets will be tombstoned on publish`,
);
if (staleDocs.length > 0) {
  console.log(`  Documents: ${staleDocs.slice(0, 20).join(", ")}${staleDocs.length > 20 ? ", ..." : ""}`);
}
if (staleAssets.length > 0) {
  console.log(`  Assets: ${staleAssets.slice(0, 20).join(", ")}${staleAssets.length > 20 ? ", ..." : ""}`);
}
if (staleHashVersion > 0) {
  console.log(
    `Hash format: ${staleHashVersion} of the changed documents differ only by hash format ` +
      `(ask an operator to run the content-hash backfill to migrate without re-uploading).`,
  );
}
console.log(`Run id:    ${result.runId}`);
