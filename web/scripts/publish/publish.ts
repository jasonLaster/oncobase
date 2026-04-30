import fs from "node:fs";
import { embedBatch } from "../../src/lib/embeddings";
import { loadConfig, loadPublishToken } from "./config";
import {
  readVaultAssets,
  readVaultDocuments,
  type PublishAsset,
  type PublishDocument,
} from "./walk-vault";

function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function post(url: string, token: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

// Vercel function bodies cap around 24MB on Fluid Compute defaults;
// stream-direct-upload is the proper fix for outliers (e.g. 100MB
// PDFs in the obsidian sources tree). Phase 4 covers ~99% of typical
// wiki assets and skips outliers with a clear warning + log.
const MAX_ASSET_BYTES = 24 * 1024 * 1024;
const SKIPPED_ASSET_LOG = ".skipped-assets.txt";
// OpenAI embeddings cap at 300K tokens per request and ~8K tokens
// per input. Chunk by total chars (rough upper bound for tokens) to
// stay safely under both limits without modeling the tokenizer.
const EMBED_BATCH_MAX_CHARS = 800_000;
const EMBED_BATCH_MAX_DOCS = 100;

async function uploadAsset(
  assetUrl: string,
  token: string,
  siteSlug: string,
  asset: PublishAsset,
) {
  const body = fs.readFileSync(asset.filePath);
  const response = await fetch(assetUrl, {
    method: "POST",
    headers: {
      "Content-Type": asset.contentType,
      Authorization: `Bearer ${token}`,
      "x-publish-site": siteSlug,
      "x-publish-path": asset.relativePath,
      "x-publish-kind": asset.kind,
      "x-publish-hash": asset.hash,
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function embedInChunks(
  docs: PublishDocument[],
): Promise<(number[] | undefined)[]> {
  const out: (number[] | undefined)[] = new Array(docs.length).fill(undefined);
  let i = 0;
  while (i < docs.length) {
    let j = i;
    let charSum = 0;
    while (j < docs.length && j - i < EMBED_BATCH_MAX_DOCS) {
      const next = charSum + docs[j].content.length;
      if (j > i && next > EMBED_BATCH_MAX_CHARS) break;
      charSum = next;
      j++;
    }
    const chunk = docs.slice(i, j);
    const embeddings = await embedBatch(chunk.map((d) => d.content));
    for (let k = 0; k < chunk.length; k++) {
      out[i + k] = embeddings[k];
    }
    i = j;
  }
  return out;
}

const args = process.argv.slice(2);
const site = readFlag(args, "--site");
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

if (!site) {
  console.error(
    "Usage: bun scripts/publish/publish.ts --site <slug> [--dry-run] [--force]",
  );
  process.exit(1);
}

const config = loadConfig(site);
const token = loadPublishToken(site);
const documents = readVaultDocuments(config.vaultPath);
const assets = readVaultAssets(config.vaultPath);

const begin = (await post(`${config.publishUrl}/begin`, token, {
  siteSlug: config.site,
  manifest: {
    documents: documents.map(({ slug, hash }) => ({ slug, hash })),
    assets: assets.map(({ relativePath, hash, kind }) => ({
      path: relativePath,
      hash,
      kind,
    })),
  },
  force,
})) as {
  runId: string;
  missingDocumentSlugs: string[];
  missingAssetPaths: string[];
};

const changedDocs = force
  ? documents
  : documents.filter((doc) => begin.missingDocumentSlugs.includes(doc.slug));
const missingAssetPathSet = new Set(begin.missingAssetPaths);
const changedAssets = force
  ? assets
  : assets.filter((asset) => missingAssetPathSet.has(asset.relativePath));

if (dryRun) {
  console.log(
    `Dry run: ${changedDocs.length} documents changed, ${changedAssets.length} assets changed`,
  );
  process.exit(0);
}

const doEmbed = Boolean(process.env.OPENAI_API_KEY) && changedDocs.length > 0;
const embeddings = doEmbed
  ? await embedInChunks(changedDocs)
  : new Array<undefined>(changedDocs.length).fill(undefined);

for (let i = 0; i < changedDocs.length; i++) {
  const doc = changedDocs[i];
  await post(`${config.publishUrl}/document`, token, {
    runId: begin.runId,
    siteSlug: config.site,
    ...doc,
    embedding: embeddings[i],
  });
  if ((i + 1) % 100 === 0) {
    console.log(`  ${i + 1}/${changedDocs.length} documents`);
  }
}

const skipped: PublishAsset[] = [];
let uploaded = 0;
for (const asset of changedAssets) {
  if (asset.sizeBytes > MAX_ASSET_BYTES) {
    skipped.push(asset);
    continue;
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
}

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
  deletedDocSlugs: [],
  deletedAssetPaths: [],
});

console.log(
  `Published ${changedDocs.length} documents and ${uploaded} assets for ${config.site}.`,
);
