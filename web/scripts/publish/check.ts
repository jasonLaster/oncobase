import { loadConfig, loadPublishToken } from "./config";
import { readVaultAssets, readVaultDocuments } from "./walk-vault";

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

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
  console.error(
    `Publish check failed: ${response.status} ${await response.text()}`,
  );
  process.exit(1);
}

const result = (await response.json()) as {
  runId: string;
  missingDocumentSlugs: string[];
  missingAssetPaths: string[];
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
console.log(`Run id:    ${result.runId}`);
