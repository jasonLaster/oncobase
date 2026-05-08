import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { readFlag } from "./cli";
import { loadConfig, loadPublishToken } from "./config";
import { syncSkills } from "./skills";
import { PUBLISHER_PROTOCOL_VERSION, PUBLISHER_VERSION_HEADER } from "./version";
import { readErrorBody } from "./http";
import {
  hashBytes,
  hashDocument,
  readVaultAssets,
  readVaultDocuments,
} from "./walk-vault";

type RemoteDoc = {
  slug: string;
  title: string;
  content: string;
  tags?: string[];
  contentHash?: string;
  sensitive?: boolean;
};

type RemoteAsset = {
  kind: "pdf" | "file";
  path: string;
  contentHash?: string;
  blobUrl: string;
};

type SyncOptions = {
  site: string;
};

export type SyncResult = {
  site: string;
  created: number;
  reviewed: number;
  unchanged: number;
  skippedAssets: SkippedAsset[];
  orphanDocs: string[];
  orphanAssets: string[];
  conflicts: string[];
  reviewDir: string | null;
  usedPlanEndpoint: boolean;
};

type SkippedAsset = {
  path: string;
  reason: string;
};

const ASSET_SYNC_CONCURRENCY = 12;
const SYNC_CACHE_VERSION = 1;

type LocalDocManifest = {
  slug: string;
  hash: string;
};

type LocalAssetManifest = {
  kind: "pdf" | "file";
  path: string;
  hash: string;
};

type SyncPlan = {
  documents: RemoteDoc[];
  assets: RemoteAsset[];
  remoteDocSlugs: Set<string>;
  remoteAssetKeys: Set<string>;
  orphanDocs: string[];
  orphanAssets: string[];
  planned: boolean;
};

type SyncCacheAsset = {
  contentHash?: string;
  blobUrl: string;
  status: "hash-mismatch" | "download-error";
  reason: string;
  checkedAt: string;
};

type SyncCache = {
  version: number;
  site: string;
  vaultPath: string;
  assets: Record<string, SyncCacheAsset>;
};

function reviewRoot(vaultPath: string, site: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(vaultPath, ".wiki-sync-review", `${site}-${stamp}`);
}

function syncCachePath(vaultPath: string, site: string) {
  const vaultKey = crypto.createHash("sha256").update(path.resolve(vaultPath)).digest("hex").slice(0, 12);
  return path.join(os.homedir(), ".cache", "wiki-sync", `${site}-${vaultKey}.json`);
}

function readSyncCache(vaultPath: string, site: string): SyncCache {
  const file = syncCachePath(vaultPath, site);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SyncCache;
    if (parsed.version === SYNC_CACHE_VERSION && parsed.site === site) {
      return { ...parsed, assets: parsed.assets ?? {} };
    }
  } catch {
    // Cache misses and corrupt cache files should not block sync.
  }
  return {
    version: SYNC_CACHE_VERSION,
    site,
    vaultPath: path.resolve(vaultPath),
    assets: {},
  };
}

function writeSyncCache(vaultPath: string, site: string, cache: SyncCache) {
  const file = syncCachePath(vaultPath, site);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`);
}

export function formatRemoteDocument(doc: RemoteDoc) {
  const frontmatter: Record<string, unknown> = {
    title: doc.title,
    tags: doc.tags ?? [],
  };
  if (doc.sensitive) frontmatter.sensitive = true;
  const raw = matter.stringify(doc.content, frontmatter);
  return doc.content.endsWith("\n") ? raw : raw.replace(/\n$/, "");
}

function ensureInsideVault(vaultPath: string, relativePath: string) {
  const resolved = path.resolve(vaultPath, relativePath);
  const root = path.resolve(vaultPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to write outside vault: ${relativePath}`);
  }
  return resolved;
}

async function post<T>(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
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
      throw new Error(`${await response.text()}\nDownload the latest vault starter, then retry.`);
    }
    throw new Error(`${response.status} ${await readErrorBody(response)}`);
  }
  return (await response.json()) as T;
}

async function listRemoteDocs(publishUrl: string, token: string, siteSlug: string) {
  const docs: RemoteDoc[] = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: {
      page: RemoteDoc[];
      isDone: boolean;
      continueCursor: string;
    } = await post(`${publishUrl}/sync/documents`, token, {
      siteSlug,
      cursor,
      numItems: 500,
    });
    docs.push(...page.page);
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
  return docs;
}

async function listRemoteAssets(publishUrl: string, token: string, siteSlug: string) {
  const assets: RemoteAsset[] = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: {
      page: RemoteAsset[];
      isDone: boolean;
      continueCursor: string;
    } = await post(`${publishUrl}/sync/assets`, token, {
      siteSlug,
      cursor,
      numItems: 500,
    });
    assets.push(...page.page);
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
  return assets;
}

async function loadSyncPlan(
  publishUrl: string,
  token: string,
  siteSlug: string,
  localDocs: Map<string, { hash: string }>,
  localAssets: Map<string, { kind: "pdf" | "file"; relativePath: string; hash: string }>,
): Promise<SyncPlan> {
  const documentManifest: LocalDocManifest[] = Array.from(localDocs.entries()).map(
    ([slug, doc]) => ({ slug, hash: doc.hash }),
  );
  const assetManifest: LocalAssetManifest[] = Array.from(localAssets.values()).map(
    (asset) => ({
      kind: asset.kind,
      path: asset.relativePath,
      hash: asset.hash,
    }),
  );

  try {
    const plan: {
      documents: RemoteDoc[];
      assets: RemoteAsset[];
      orphanDocs: string[];
      orphanAssets: string[];
    } = await post(`${publishUrl}/sync/plan`, token, {
      siteSlug,
      manifest: {
        documents: documentManifest,
        assets: assetManifest,
      },
    });
    return {
      documents: plan.documents,
      assets: plan.assets,
      remoteDocSlugs: new Set([
        ...documentManifest
          .map((doc) => doc.slug)
          .filter((slug) => !plan.orphanDocs.includes(slug)),
        ...plan.documents.map((doc) => doc.slug),
      ]),
      remoteAssetKeys: new Set([
        ...assetManifest
          .map((asset) => `${asset.kind}:${asset.path}`)
          .filter((key) => !plan.orphanAssets.includes(key)),
        ...plan.assets.map((asset) => `${asset.kind}:${asset.path}`),
      ]),
      orphanDocs: plan.orphanDocs,
      orphanAssets: plan.orphanAssets,
      planned: true,
    };
  } catch (error) {
    const message = errorMessage(error);
    if (!message.startsWith("404 ")) throw error;
  }

  const documents = await listRemoteDocs(publishUrl, token, siteSlug);
  const assets = await listRemoteAssets(publishUrl, token, siteSlug);
  return {
    documents,
    assets,
    remoteDocSlugs: new Set(documents.map((doc) => doc.slug)),
    remoteAssetKeys: new Set(assets.map((asset) => `${asset.kind}:${asset.path}`)),
    orphanDocs: Array.from(localDocs.keys()).filter(
      (slug) => !documents.some((doc) => doc.slug === slug),
    ),
    orphanAssets: Array.from(localAssets.values())
      .map((asset) => `${asset.kind}:${asset.relativePath}`)
      .filter((key) => !assets.some((asset) => `${asset.kind}:${asset.path}` === key)),
    planned: false,
  };
}

async function downloadAsset(asset: RemoteAsset) {
  const response = await fetch(asset.blobUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${asset.path}: ${response.status} ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  const limit = Math.max(1, Math.floor(concurrency));
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
}

export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const config = loadConfig(options.site);
  const token = loadPublishToken(options.site);
  const vaultPath = config.vaultPath;
  const localDocs = new Map(readVaultDocuments(vaultPath).map((doc) => [doc.slug, doc]));
  const localAssets = new Map(
    readVaultAssets(vaultPath).map((asset) => [`${asset.kind}:${asset.relativePath}`, asset]),
  );
  const plan = await loadSyncPlan(
    config.publishUrl,
    token,
    config.site,
    localDocs,
    localAssets,
  );
  const remoteDocs = plan.documents;
  const remoteAssets = plan.assets;
  const remoteDocSlugs = plan.remoteDocSlugs;
  const remoteAssetKeys = plan.remoteAssetKeys;
  const reviewDirPath = reviewRoot(vaultPath, config.site);
  const conflicts: string[] = [];
  let created = 0;
  let unchanged = plan.planned
    ? Math.max(
        0,
        localDocs.size +
          localAssets.size -
          plan.orphanDocs.length -
          plan.orphanAssets.length -
          remoteDocs.length -
          remoteAssets.length,
      )
    : 0;
  let reviewed = 0;
  const skippedAssets: SkippedAsset[] = [];
  const syncCache = readSyncCache(vaultPath, config.site);

  for (const doc of remoteDocs) {
    const tags = doc.tags ?? [];
    const remoteHash =
      doc.contentHash ??
      hashDocument({
        title: doc.title,
        content: doc.content,
        tags,
        sensitive: doc.sensitive,
      });
    const local = localDocs.get(doc.slug);
    if (!local) {
      const filePath = ensureInsideVault(vaultPath, `${doc.slug}.md`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, formatRemoteDocument({ ...doc, tags }));
      created++;
      continue;
    }
    if (local.hash === remoteHash) {
      unchanged++;
      continue;
    }

    const reviewPath = ensureInsideVault(
      reviewDirPath,
      path.join("documents", `${doc.slug}.remote.md`),
    );
    fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
    fs.writeFileSync(reviewPath, formatRemoteDocument({ ...doc, tags }));
    conflicts.push(`${doc.slug}.md`);
    reviewed++;
  }

  await mapWithConcurrency(remoteAssets, ASSET_SYNC_CONCURRENCY, async (asset) => {
    const key = `${asset.kind}:${asset.path}`;
    const local = localAssets.get(key);
    if (local && local.hash === asset.contentHash) {
      unchanged++;
      return;
    }
    const cached = syncCache.assets[key];
    if (
      cached &&
      cached.blobUrl === asset.blobUrl &&
      cached.contentHash === asset.contentHash
    ) {
      skippedAssets.push({ path: asset.path, reason: `${cached.reason} (cached)` });
      return;
    }

    let body: Buffer;
    try {
      body = await downloadAsset(asset);
    } catch (error) {
      const reason = errorMessage(error);
      syncCache.assets[key] = {
        contentHash: asset.contentHash,
        blobUrl: asset.blobUrl,
        status: "download-error",
        reason,
        checkedAt: new Date().toISOString(),
      };
      skippedAssets.push({ path: asset.path, reason });
      return;
    }

    const actualHash = hashBytes(body);
    if (asset.contentHash && actualHash !== asset.contentHash) {
      const reason = `downloaded hash ${actualHash} did not match remote hash ${asset.contentHash}`;
      syncCache.assets[key] = {
        contentHash: asset.contentHash,
        blobUrl: asset.blobUrl,
        status: "hash-mismatch",
        reason,
        checkedAt: new Date().toISOString(),
      };
      skippedAssets.push({ path: asset.path, reason });
      return;
    }

    delete syncCache.assets[key];

    if (!local) {
      const filePath = ensureInsideVault(vaultPath, asset.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body);
      created++;
      return;
    }

    const reviewPath = ensureInsideVault(
      reviewDirPath,
      path.join("assets", asset.kind, asset.path),
    );
    fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
    fs.writeFileSync(reviewPath, body);
    conflicts.push(asset.path);
    reviewed++;
  });

  const orphanDocs = plan.planned
    ? plan.orphanDocs
    : Array.from(localDocs.keys()).filter((slug) => !remoteDocSlugs.has(slug));
  const orphanAssets = plan.planned
    ? plan.orphanAssets
    : Array.from(localAssets.values())
        .map((asset) => `${asset.kind}:${asset.relativePath}`)
        .filter((key) => !remoteAssetKeys.has(key));
  const orphanCount = orphanDocs.length + orphanAssets.length;

  if (reviewed > 0 || skippedAssets.length > 0) {
    fs.mkdirSync(reviewDirPath, { recursive: true });
    fs.writeFileSync(
      path.join(reviewDirPath, "summary.json"),
      `${JSON.stringify({ conflicts, orphanDocs, orphanAssets, skippedAssets }, null, 2)}\n`,
    );
  }

  console.log(
    `Sync ${config.site}: +${created} created, ~${reviewed} review, =${unchanged} unchanged, !${skippedAssets.length} skipped, ?${orphanCount} orphan`,
  );
  if (reviewed > 0) {
    console.warn(`Divergent local files were not overwritten. Review remote copies in ${reviewDirPath}`);
  }
  if (orphanCount > 0) {
    console.warn("Local-only files are unchanged. They may be new local work or previously tombstoned remote content.");
  }
  if (skippedAssets.length > 0) {
    console.warn(
      `Skipped ${skippedAssets.length} remote assets that could not be downloaded safely. Review ${path.join(reviewDirPath, "summary.json")}`,
    );
    for (const asset of skippedAssets.slice(0, 20)) {
      console.warn(`  ${asset.path}: ${asset.reason}`);
    }
    if (skippedAssets.length > 20) {
      console.warn(`  ... ${skippedAssets.length - 20} more`);
    }
  }
  writeSyncCache(vaultPath, config.site, syncCache);
  syncSkills(config.site);

  return {
    site: config.site,
    created,
    reviewed,
    unchanged,
    skippedAssets,
    orphanDocs,
    orphanAssets,
    conflicts,
    reviewDir: reviewed > 0 || skippedAssets.length > 0 ? reviewDirPath : null,
    usedPlanEndpoint: plan.planned,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const site = readFlag(args, "--site");
  if (!site) {
    console.error("Usage: bun scripts/publish/sync.ts --site <slug>");
    process.exit(1);
  }
  await runSync({ site });
}
