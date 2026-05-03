import { loadConfig, loadPublishToken } from "./config";
import { readVaultAssets, readVaultDocuments } from "./walk-vault";
import { readFlag } from "./cli";
import { PUBLISHER_PROTOCOL_VERSION, PUBLISHER_VERSION_HEADER } from "./version";

const site = readFlag(process.argv.slice(2), "--site");
if (!site) {
  console.error("Usage: bun scripts/publish/check.ts --site <slug>");
  process.exit(1);
}

const config = loadConfig(site);
const token = loadPublishToken(site);
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
    dryRun: true,
    manifest: {
      documents: documents.map(({ slug, hash }) => ({ slug, hash })),
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
    console.error("Update the publisher scripts, then retry. For a vault, download the latest starter zip and copy scripts/publish/ over this vault.");
    process.exit(1);
  }
  console.error(
    `Publish check failed: ${response.status} ${await response.text()}`,
  );
  process.exit(1);
}

const result = (await response.json()) as {
  runId: string;
  missingDocumentSlugs: string[];
  missingAssetPaths: string[];
  staleDocumentSlugs?: string[];
  staleAssetPaths?: string[];
};

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
  `Stale:     ${result.staleDocumentSlugs?.length ?? 0} documents, ${
    result.staleAssetPaths?.length ?? 0
  } assets will be tombstoned on publish`,
);
console.log(`Run id:    ${result.runId}`);
