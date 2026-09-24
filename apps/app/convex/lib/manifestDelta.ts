import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parseWikiManifest, type WikiManifest, type WikiManifestPage } from "@oncobase/wiki-content";

const hash = (core: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(core)))).slice(0, 24);
/** Pure, conservative fast path. No new/deleted/private pages, no asset changes.
 * Tree entries depend on slugs; replacing existing public metadata preserves them. */
export function patchManifestPages(raw: unknown, siteSlug: string, expectedHash: string, updates: Array<WikiManifestPage | null>) {
  parseWikiManifest(raw); // Validate shape, but do not hash the parser's normalized key order.
  const base = raw as WikiManifest;
  const core = { schemaVersion: base.schemaVersion, siteSlug: base.siteSlug, scope: base.scope,
    compactTree: base.compactTree, pages: base.pages, assets: base.assets };
  if (base.siteSlug !== siteSlug || base.scope !== "public" || base.manifestHash !== expectedHash || hash(core) !== expectedHash) return null;
  const existing = new Set(base.pages.map(page => page.slug));
  if (updates.some(page => !page || page.sensitive || !existing.has(page.slug))) return null;
  const replacements = new Map(updates.map(page => [page!.slug, page!]));
  if (replacements.size !== updates.length) return null;
  const next = { ...core, pages: base.pages.map(page => replacements.has(page.slug) ? { ...page, ...replacements.get(page.slug) } : page) };
  return JSON.stringify({ ...next, manifestHash: hash(next), generatedAt: new Date().toISOString() });
}
