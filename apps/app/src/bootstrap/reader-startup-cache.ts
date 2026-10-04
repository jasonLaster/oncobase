import { parseWikiManifest, parseWikiPageBatch, parseWikiSessionIdentity, expandCompactFileTree, transformFileTreeForSidebar,
  WIKI_READER_CACHE_VERSION, WIKI_SESSION_CACHE_VERSION, type WikiManifest, type WikiPageRecord, type WikiSessionIdentity } from "@oncobase/wiki-content";
import type { InitialReaderData } from "./initial-reader-data";
import { contentSlugFromRouteSlug, slugFromPath } from "../wiki-utils";
import { READER_SHELL_COOKIE } from "./reader-shell-hint";
import { gunzipSync } from "fflate";
import { STARTUP_CACHE_EPOCH, startupCacheKey, startupPartition } from "./startup-cache-lifecycle";
export { STARTUP_CACHE_EPOCH, startupCacheKey, startupPartition, clearStartupSnapshot } from "./startup-cache-lifecycle";

export const STARTUP_CACHE_MAX_BYTES = 2 * 1024 * 1024;
export const STARTUP_CACHE_MAX_DECODED_BYTES = 16 * 1024 * 1024;
export const STARTUP_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export type StartupSnapshot = {
  version: 1; partition: string; readerVersion: string; identity: WikiSessionIdentity;
  accountTag?: string;
  validatedAt: number; manifest: WikiManifest;
  bodies: { pathname: string; fetchedAt: number; page: WikiPageRecord }[];
};
export function sameStartupIdentity(a: WikiSessionIdentity, b: WikiSessionIdentity) {
  return a.siteSlug === b.siteSlug && a.scope === b.scope && a.cacheKey === b.cacheKey &&
    a.cacheVersion === b.cacheVersion && a.userHash === b.userHash && a.authenticated === b.authenticated;
}

// Boot decodes the stored snapshot; the cache writer's first rebuild after
// validation reads the same stored string. Reuse that one decode (re-checking
// only the clock-dependent bounds) instead of inflating and parsing it again.
let lastDecoded: { raw: string; partition: string; snapshot: StartupSnapshot } | null = null;
function withinAge(snapshot: StartupSnapshot, now: number) {
  return [snapshot.validatedAt, ...snapshot.bodies.map(body => body.fetchedAt)].every(at => now >= at && now - at <= STARTUP_CACHE_MAX_AGE);
}

export function parseStartupSnapshot(raw: string | null, partition: string, now = Date.now()): StartupSnapshot | null {
  if (raw && lastDecoded && lastDecoded.raw === raw && lastDecoded.partition === partition) {
    const { snapshot } = lastDecoded;
    lastDecoded = null;
    return withinAge(snapshot, now) ? snapshot : null;
  }
  const snapshot = decodeStartupSnapshot(raw, partition, now);
  lastDecoded = raw && snapshot ? { raw, partition, snapshot } : null;
  return snapshot;
}

function decodeStartupSnapshot(raw: string | null, partition: string, now: number): StartupSnapshot | null {
  try {
    if (!raw || raw.length > STARTUP_CACHE_MAX_BYTES) return null;
    let json = raw;
    if (raw.startsWith("gz1:")) {
      const binary = atob(raw.slice(4));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (bytes.length < 18) return null;
      const size = new DataView(bytes.buffer).getUint32(bytes.length - 4, true);
      // Bound the inflater's output allocation before touching cached bytes.
      if (!size || size > STARTUP_CACHE_MAX_DECODED_BYTES) return null;
      json = new TextDecoder().decode(gunzipSync(bytes, { out: new Uint8Array(size) }));
    }
    const value = JSON.parse(json);
    if (value.version !== 1 || value.partition !== partition || value.readerVersion !== WIKI_READER_CACHE_VERSION ||
        !Number.isFinite(value.validatedAt) || value.validatedAt <= 0 || now < value.validatedAt || now - value.validatedAt > STARTUP_CACHE_MAX_AGE) return null;
    const identity = parseWikiSessionIdentity(value.identity);
    if (identity.cacheVersion !== WIKI_SESSION_CACHE_VERSION || !identity.cacheKey ||
        (identity.scope === "session" ? !identity.authenticated || !identity.userHash : identity.authenticated || identity.userHash !== null)) return null;
    const manifest = parseWikiManifest(value.manifest);
    if (manifest.siteSlug !== identity.siteSlug || manifest.scope !== identity.scope || !manifest.manifestHash ||
        !Array.isArray(value.bodies) || value.bodies.length > 8) return null;
    const pages = new Map(manifest.pages.map(page => [page.slug, page]));
    const bodies = value.bodies.map((body: StartupSnapshot["bodies"][number]) => {
      const page = parseWikiPageBatch({ siteSlug: identity.siteSlug, scope: identity.scope, generatedAt: "", isDone: true, continueCursor: null, pages: [body.page] }).pages[0];
      if (typeof body.pathname !== "string" || !body.pathname.startsWith("/") || body.pathname.length > 512 ||
          contentSlugFromRouteSlug(slugFromPath(body.pathname)) !== page.slug || !pages.has(page.slug) ||
          !Number.isFinite(body.fetchedAt) || body.fetchedAt <= 0 || now < body.fetchedAt || now - body.fetchedAt > STARTUP_CACHE_MAX_AGE ||
          !page.content || (identity.scope === "public" && page.sensitive)) throw new Error("Invalid cached page");
      return { pathname: body.pathname, fetchedAt: body.fetchedAt, page };
    });
    if (value.accountTag !== undefined && (typeof value.accountTag !== "string" || value.accountTag.length > 80)) return null;
    return { version: 1, partition, readerVersion: WIKI_READER_CACHE_VERSION, identity, accountTag: value.accountTag, validatedAt: value.validatedAt, manifest, bodies };
  } catch { return null; }
}

export function readStartupSnapshot(): StartupSnapshot | null {
  try {
    const query = new URLSearchParams(location.search);
    if (query.get("readerCache") === "0" || query.get("readerBootstrap") === "0") return null;
    const snapshot = parseStartupSnapshot(localStorage.getItem(startupCacheKey(startupPartition())), startupPartition());
    // HTML already checks the current cookie. Reuse its cheap account tag to
    // avoid flashing another account's cache, without recomputing permissions.
    const account = document.querySelector<HTMLMetaElement>('meta[name="wiki-reader-account"]')?.content;
    if (account && account !== "unknown" && snapshot?.accountTag !== account) return null;
    const scope = query.get("scope");
    return snapshot && (!import.meta.env.VITE_WIKI_SITE_SLUG || snapshot.identity.siteSlug === import.meta.env.VITE_WIKI_SITE_SLUG) &&
      (!(scope === "public" || scope === "session") || snapshot.identity.scope === scope) ? snapshot : null;
  } catch { return null; }
}

export function startupInitialData(snapshot: StartupSnapshot, pathname: string): InitialReaderData | null {
  const slug = contentSlugFromRouteSlug(slugFromPath(pathname));
  const body = snapshot.bodies.find(body => body.page.slug === slug);
  const pages = snapshot.manifest.pages.map(page => ({ ...page, tagsJson: JSON.stringify(page.tags) }));
  const index = pages.find(page => page.slug === slug);
  if (!index) return null;
  const cachedBodies = Object.fromEntries(snapshot.bodies.map(body => [body.page.slug, {
    ...body.page, tagsJson: JSON.stringify(body.page.tags), expectedContentHash: body.page.contentHash,
    contentStatus: "fresh" as const, fetchedAt: body.fetchedAt, missingAt: null, staleAt: null, deletedAt: null,
  }]));
  return { index, pages, tree: transformFileTreeForSidebar(expandCompactFileTree(snapshot.manifest.compactTree)),
    cachedBodies, expiresAt: Math.min(snapshot.validatedAt, body?.fetchedAt ?? snapshot.validatedAt) + STARTUP_CACHE_MAX_AGE,
    page: cachedBodies[slug] ?? { ...index, content: "", expectedContentHash: index.contentHash,
      contentStatus: "fresh", fetchedAt: 0, missingAt: null, staleAt: null, deletedAt: null } };
}

/**
 * `trusted` skips decoding and re-validating `raw` when the caller just
 * encoded it from LiveStore rows; readers still validate on every read, so a
 * bad snapshot is ignored rather than trusted.
 */
export function writeStartupSnapshot(snapshot: StartupSnapshot, epoch: string | null, raw = JSON.stringify(snapshot), { trusted = false } = {}): boolean {
  try {
    if (localStorage.getItem(STARTUP_CACHE_EPOCH) !== epoch) return false;
    if (new Blob([raw]).size > STARTUP_CACHE_MAX_BYTES || (!trusted && !parseStartupSnapshot(raw, snapshot.partition))) return false;
    localStorage.setItem(startupCacheKey(snapshot.partition), raw);
    const paths = [...new Set(snapshot.bodies.map(body => body.pathname))];
    const hint = encodeURIComponent(JSON.stringify(paths));
    try {
      if (hint.length <= 3000) document.cookie = `${READER_SHELL_COOKIE}=${hint}; Path=/; Max-Age=${STARTUP_CACHE_MAX_AGE / 1000}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch { /* The snapshot still works with an ordinary HTML response. */ }
    return true;
  } catch { return false; }
}
