import fs from "node:fs";
import { sitePut } from "../../src/lib/blob";
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

// Assets go directly to Vercel Blob from the publisher (the function
// is metadata-only), so the cap here is just RAM headroom for
// fs.readFileSync. Stream the body if outliers exceed this.
const MAX_ASSET_BYTES = 200 * 1024 * 1024;
const SKIPPED_ASSET_LOG = ".skipped-assets.txt";
// Doc POSTs are small JSON; asset uploads are up to 24MB and bandwidth-bound.
const DOC_CONCURRENCY = 16;
const ASSET_CONCURRENCY = 6;

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
const EMBED_CONCURRENCY = 8;

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

async function embedInChunks(
  docs: PublishDocument[],
): Promise<(number[] | undefined)[]> {
  const out: (number[] | undefined)[] = new Array(docs.length).fill(undefined);
  let done = 0;
  await runWithConcurrency(docs, EMBED_CONCURRENCY, async (doc, i) => {
    try {
      const [vec] = await embedBatch([doc.content]);
      out[i] = vec;
    } catch (error) {
      console.warn(
        `  skipping embedding for ${doc.slug}: ${(error as Error).message}`,
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
  dryRun,
})) as {
  runId: string;
  missingDocumentSlugs: string[];
  missingAssetPaths: string[];
  staleDocumentSlugs?: string[];
  staleAssetPaths?: string[];
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
    `Dry run: ${changedDocs.length} documents changed, ${changedAssets.length} assets changed, ${
      begin.staleDocumentSlugs?.length ?? 0
    } documents stale, ${begin.staleAssetPaths?.length ?? 0} assets stale`,
  );
  process.exit(0);
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

console.log(
  `Published ${changedDocs.length} documents, ${uploaded} assets, tombstoned ${
    begin.staleDocumentSlugs?.length ?? 0
  } documents and ${begin.staleAssetPaths?.length ?? 0} assets for ${config.site}.`,
);
