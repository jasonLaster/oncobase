import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parseWikiManifest, type WikiManifest, type WikiManifestPage } from "@oncobase/wiki-content";
import { buildCompactTreeFromManifest } from "@oncobase/wiki-content/manifest-tree";

const hash = (core: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(core)))).slice(0, 24);
/** Public document-only changes. Additions rebuild the tree from the verified
 * snapshot; deletions/private pages and asset changes still require a full build. */
export function patchManifestPages(raw: unknown, siteSlug: string, expectedHash: string, updates: Array<WikiManifestPage | null>) {
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
  const next = { ...core, compactTree: additions.length ? buildCompactTreeFromManifest(pages, base.assets) : base.compactTree, pages };
  return JSON.stringify({ ...next, manifestHash: hash(next), generatedAt: new Date().toISOString() });
}
