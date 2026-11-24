import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { isListedManifestAsset, isManifestFileAssetPath, parseWikiManifest, type WikiManifest, type WikiManifestAsset, type WikiManifestPage } from "@oncobase/wiki-content";
import { buildCompactTreeFromManifest } from "@oncobase/wiki-content/manifest-tree";

const hash = (core: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(core)))).slice(0, 24);
/** The public visibility of one upserted asset, read after the publish. */
export type ManifestAssetUpdate = { kind: "pdf" | "file"; path: string; listed: boolean; contentHash: string | null };

/** Apply asset upserts the way the full builder lists them: PDFs first, then
 * image files, each in path order; non-image files are never listed. Returns
 * whether the PDF set (the only assets in the tree) changed. */
function patchAssets(base: WikiManifestAsset[], updates: ManifestAssetUpdate[]) {
  const assets = [...base];
  let listedChanged = false;
  for (const update of updates) {
    if (update.kind === "file" && !isManifestFileAssetPath(update.path)) continue;
    const index = assets.findIndex(asset => asset.kind === update.kind && asset.path === update.path);
    if (!update.listed) {
      if (index >= 0) { assets.splice(index, 1); listedChanged ||= isListedManifestAsset(update); }
    } else if (index >= 0) {
      assets[index] = { ...assets[index], contentHash: update.contentHash };
    } else {
      const at = assets.findIndex(asset => update.kind === "pdf"
        ? asset.kind !== "pdf" || asset.path > update.path
        : asset.kind === "file" && asset.path > update.path);
      assets.splice(at < 0 ? assets.length : at, 0, { kind: update.kind, path: update.path, contentHash: update.contentHash, size: null });
      listedChanged ||= isListedManifestAsset(update);
    }
  }
  return { assets, listedChanged };
}

/** Public document and asset upserts. Additions rebuild the tree from the
 * verified snapshot; deletions and private pages still require a full build. */
export function patchManifestPages(raw: unknown, siteSlug: string, expectedHash: string, updates: Array<WikiManifestPage | null>, assetUpdates: ManifestAssetUpdate[] = []) {
  parseWikiManifest(raw); // Validate shape, but do not hash the parser's normalized key order.
  const base = raw as WikiManifest;
  const core = { schemaVersion: base.schemaVersion, siteSlug: base.siteSlug, scope: base.scope,
    compactTree: base.compactTree, pages: base.pages, assets: base.assets };
  if (base.siteSlug !== siteSlug || base.scope !== "public" || base.manifestHash !== expectedHash || hash(core) !== expectedHash) return null;
  const existing = new Set(base.pages.map(page => page.slug));
  if (updates.some(page => !page || page.sensitive)) return null;
  const replacements = new Map(updates.map(page => [page!.slug, page!]));
  if (replacements.size !== updates.length) return null;
  const additions = updates.filter((page): page is WikiManifestPage => Boolean(page && !existing.has(page.slug)));
  const pages = base.pages.map(page => replacements.has(page.slug) ? { ...page, ...replacements.get(page.slug) } : page);
  // Convex serializes both metadata queries in the same key order. Preserve it,
  // including for additions, because the wire representation defines the hash.
  pages.push(...additions);
  if (additions.length) pages.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const { assets, listedChanged } = patchAssets(base.assets, assetUpdates);
  const next = { ...core, compactTree: additions.length || listedChanged ? buildCompactTreeFromManifest(pages, assets.filter(isListedManifestAsset)) : base.compactTree, pages, assets };
  return JSON.stringify({ ...next, manifestHash: hash(next), generatedAt: new Date().toISOString() });
}
