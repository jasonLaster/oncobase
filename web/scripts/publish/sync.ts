import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { readFlag } from "./cli";
import { loadConfig, loadPublishToken } from "./config";
import { syncSkills } from "./skills";
import { PUBLISHER_PROTOCOL_VERSION, PUBLISHER_VERSION_HEADER } from "./version";
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

function reviewRoot(vaultPath: string, site: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(vaultPath, ".wiki-sync-review", `${site}-${stamp}`);
}

export function formatRemoteDocument(doc: RemoteDoc) {
  const raw = matter.stringify(doc.content, {
    title: doc.title,
    tags: doc.tags ?? [],
  });
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
    throw new Error(`${response.status} ${await response.text()}`);
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

async function downloadAsset(asset: RemoteAsset) {
  const response = await fetch(asset.blobUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${asset.path}: ${response.status} ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function runSync(options: SyncOptions) {
  const config = loadConfig(options.site);
  const token = loadPublishToken(options.site);
  const vaultPath = config.vaultPath;
  const remoteDocs = await listRemoteDocs(config.publishUrl, token, config.site);
  const remoteAssets = await listRemoteAssets(config.publishUrl, token, config.site);
  const localDocs = new Map(readVaultDocuments(vaultPath).map((doc) => [doc.slug, doc]));
  const localAssets = new Map(
    readVaultAssets(vaultPath).map((asset) => [`${asset.kind}:${asset.relativePath}`, asset]),
  );
  const remoteDocSlugs = new Set(remoteDocs.map((doc) => doc.slug));
  const remoteAssetKeys = new Set(remoteAssets.map((asset) => `${asset.kind}:${asset.path}`));
  const reviewDir = reviewRoot(vaultPath, config.site);
  const conflicts: string[] = [];
  let created = 0;
  let unchanged = 0;
  let reviewed = 0;

  for (const doc of remoteDocs) {
    const tags = doc.tags ?? [];
    const remoteHash =
      doc.contentHash ?? hashDocument({ title: doc.title, content: doc.content, tags });
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
      reviewDir,
      path.join("documents", `${doc.slug}.remote.md`),
    );
    fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
    fs.writeFileSync(reviewPath, formatRemoteDocument({ ...doc, tags }));
    conflicts.push(`${doc.slug}.md`);
    reviewed++;
  }

  for (const asset of remoteAssets) {
    const key = `${asset.kind}:${asset.path}`;
    const local = localAssets.get(key);
    if (local && local.hash === asset.contentHash) {
      unchanged++;
      continue;
    }

    const body = await downloadAsset(asset);
    const actualHash = hashBytes(body);
    if (asset.contentHash && actualHash !== asset.contentHash) {
      throw new Error(`Downloaded hash mismatch for ${asset.path}`);
    }

    if (!local) {
      const filePath = ensureInsideVault(vaultPath, asset.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body);
      created++;
      continue;
    }

    const reviewPath = ensureInsideVault(
      reviewDir,
      path.join("assets", asset.kind, asset.path),
    );
    fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
    fs.writeFileSync(reviewPath, body);
    conflicts.push(asset.path);
    reviewed++;
  }

  const orphanDocs = Array.from(localDocs.keys()).filter((slug) => !remoteDocSlugs.has(slug));
  const orphanAssets = Array.from(localAssets.values())
    .map((asset) => `${asset.kind}:${asset.relativePath}`)
    .filter((key) => !remoteAssetKeys.has(key));
  const orphanCount = orphanDocs.length + orphanAssets.length;

  if (reviewed > 0) {
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewDir, "summary.json"),
      `${JSON.stringify({ conflicts, orphanDocs, orphanAssets }, null, 2)}\n`,
    );
  }

  console.log(
    `Sync ${config.site}: +${created} created, ~${reviewed} review, =${unchanged} unchanged, ?${orphanCount} orphan`,
  );
  if (reviewed > 0) {
    console.warn(`Divergent local files were not overwritten. Review remote copies in ${reviewDir}`);
  }
  if (orphanCount > 0) {
    console.warn("Local-only files are unchanged. They may be new local work or previously tombstoned remote content.");
  }
  syncSkills(config.site);
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
