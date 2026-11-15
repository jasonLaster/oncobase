import {
  makeWikiStoreId,
  type WikiScope,
  type WikiSessionIdentity,
  WIKI_PREVIOUS_READER_CACHE_VERSION,
  WIKI_READER_CACHE_VERSION,
  WIKI_READER_SCHEMA_VERSION,
} from "@oncobase/wiki-content";
import type { PageContentRow, PageIndexRow, SiteStateRow } from "../types";
// The same value as schema.ts exports; read it from wiki-content so the shell
// (Header) can import this module without the LiveStore schema.
const WIKI_CACHE_SCHEMA_VERSION = WIKI_READER_SCHEMA_VERSION;

type DirectoryWithKeys = FileSystemDirectoryHandle & {
  keys: () => AsyncIterableIterator<string>;
};

const SESSION_CACHE_CLEANUP_PREFIX = "wiki-vite:clear-session-cache";

function safeStoreSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function sessionReaderStoreDirectoryPrefixes({
  origin,
  siteSlug,
}: {
  origin: string;
  siteSlug: string;
}) {
  const safeSiteSlug = safeStoreSegment(siteSlug);
  const safeOrigin = safeStoreSegment(origin);
  return [
    WIKI_READER_CACHE_VERSION,
    WIKI_PREVIOUS_READER_CACHE_VERSION,
  ].map(
    (readerVersion) =>
      `livestore-wiki-vite-${readerVersion}-${safeSiteSlug}-session-${safeOrigin}-`,
  );
}

export function sessionCacheCleanupKey(siteSlug: string) {
  return `${SESSION_CACHE_CLEANUP_PREFIX}:${safeStoreSegment(siteSlug)}`;
}

export function requestSessionCacheCleanup(
  storage: Pick<Storage, "setItem">,
  siteSlug: string,
) {
  storage.setItem(sessionCacheCleanupKey(siteSlug), "1");
}

export async function retireRequestedSessionReaderStores({
  localStorage,
  origin,
  siteSlug,
  storage = navigator.storage,
}: {
  localStorage: Pick<Storage, "getItem" | "removeItem">;
  origin: string;
  siteSlug: string;
  storage?: StorageManager;
}) {
  const cleanupKey = sessionCacheCleanupKey(siteSlug);
  if (localStorage.getItem(cleanupKey) !== "1") return [];
  const directory = await storage?.getDirectory?.().catch(() => undefined);
  if (!directory || typeof (directory as DirectoryWithKeys).keys !== "function") {
    return [];
  }

  const prefixes = sessionReaderStoreDirectoryPrefixes({ origin, siteSlug });
  const retired: string[] = [];
  let failed = false;
  for await (const name of (directory as DirectoryWithKeys).keys()) {
    if (
      !prefixes.some((prefix) => name.startsWith(prefix)) ||
      !/@\d+$/.test(name)
    ) {
      continue;
    }
    try {
      await directory.removeEntry(name, { recursive: true });
      retired.push(name);
    } catch {
      failed = true;
    }
  }
  if (!failed) localStorage.removeItem(cleanupKey);
  return retired;
}

export function previousReaderStoreDirectoryPrefix({
  identity,
  origin,
  scope,
}: {
  identity: WikiSessionIdentity;
  origin: string;
  scope: WikiScope;
}) {
  const storeId = makeWikiStoreId({
    siteSlug: identity.siteSlug,
    scope,
    origin,
    cacheKey: identity.cacheKey,
    readerCacheVersion: WIKI_PREVIOUS_READER_CACHE_VERSION,
  });
  return `livestore-${storeId}@`;
}

export function isCurrentReaderHydrated({
  identity,
  page,
  scope,
  state,
}: {
  identity: WikiSessionIdentity;
  page: PageContentRow | null;
  scope: WikiScope;
  state: SiteStateRow | null;
}) {
  return Boolean(
    isCurrentReaderManifestValidated({ identity, scope, state }) &&
      page?.fetchedAt &&
      page.contentStatus === "fresh" &&
      page.deletedAt === null &&
      page.missingAt === null &&
      page.contentHash === page.expectedContentHash,
  );
}

export function isCurrentReaderManifestValidated({
  identity,
  scope,
  state,
}: {
  identity: WikiSessionIdentity;
  scope: WikiScope;
  state: SiteStateRow | null;
}) {
  return Boolean(
    state?.schemaVersion === WIKI_CACHE_SCHEMA_VERSION &&
      state.siteSlug === identity.siteSlug &&
      state.scope === scope &&
      state.manifestHash &&
      state.lastValidatedAt > 0,
  );
}

export function isRouteUnavailableInCurrentReader({
  index,
  page,
}: {
  index: PageIndexRow | null;
  page: PageContentRow | null;
}) {
  return Boolean(
    !index ||
      index.sensitive ||
      page?.sensitive ||
      page?.contentStatus === "deleted" ||
      page?.contentStatus === "sensitive-unavailable",
  );
}

export async function retirePreviousReaderStore({
  identity,
  origin,
  scope,
  storage = navigator.storage,
}: {
  identity: WikiSessionIdentity;
  origin: string;
  scope: WikiScope;
  storage?: StorageManager;
}) {
  const directory = await storage?.getDirectory?.().catch(() => undefined);
  if (!directory || typeof (directory as DirectoryWithKeys).keys !== "function") {
    return [] as string[];
  }

  const prefix = previousReaderStoreDirectoryPrefix({ identity, origin, scope });
  const retired: string[] = [];
  for await (const name of (directory as DirectoryWithKeys).keys()) {
    if (
      !name.startsWith(prefix) ||
      !/^\d+$/.test(name.slice(prefix.length))
    ) {
      continue;
    }
    try {
      await directory.removeEntry(name, { recursive: true });
      retired.push(name);
    } catch {
      // An older tab may still hold this database open. A later load will retry.
    }
  }
  return retired;
}

/** Every reader store directory on this origin (`livestore-wiki-vite-…`). */
export const READER_STORE_DIRECTORY_PREFIX = "livestore-wiki-vite-";

export type SignOutWipeResult = {
  /** "site": every session store for the site; "all": every reader store. */
  target: "site" | "all";
  retired: string[];
  failed: string[];
};

/** Set in this document while sign-out shuts the store down and wipes it. */
let signingOut = false;
export const isSigningOut = () => signingOut;
export const markSigningOut = () => { signingOut = true; };

/**
 * P11 sign-out: delete the signed-out reader's OPFS store directories now,
 * before the page navigates away. With a known site this is every session
 * store for that site (the signed-out identity's and any older one: the
 * session cookie they belonged to is gone); with no identity at all it is
 * every reader store on the origin, public ones included (they refetch).
 *
 * The caller shuts this tab's store down first: an open store holds OPFS
 * access handles and its directory cannot be removed. A directory another
 * tab still holds open fails here; the cleanup flag set beside this call
 * retries it on the next public load (retireRequestedSessionReaderStores).
 */
export async function wipeReaderStoresOnSignOut({
  origin,
  siteSlug,
  storage = navigator.storage,
}: {
  origin: string;
  siteSlug: string | null | undefined;
  storage?: StorageManager;
}): Promise<SignOutWipeResult> {
  const target = siteSlug ? "site" : "all";
  const result: SignOutWipeResult = { target, retired: [], failed: [] };
  const directory = await storage?.getDirectory?.().catch(() => undefined);
  if (!directory || typeof (directory as DirectoryWithKeys).keys !== "function") return result;
  const prefixes = siteSlug
    ? sessionReaderStoreDirectoryPrefixes({ origin, siteSlug })
    : [READER_STORE_DIRECTORY_PREFIX];
  const names: string[] = [];
  for await (const name of (directory as DirectoryWithKeys).keys()) {
    if (prefixes.some(prefix => name.startsWith(prefix))) names.push(name);
  }
  const outcomes = await Promise.allSettled(names.map(name => directory.removeEntry(name, { recursive: true })));
  outcomes.forEach((outcome, index) => (outcome.status === "fulfilled" ? result.retired : result.failed).push(names[index]!));
  return result;
}

export const SIGN_OUT_WIPE_KEY = "wiki-vite:sign-out-wipe";

/**
 * Stop this tab's reader store (it holds the OPFS handles), then wipe. The
 * shutdown is bounded: a store that never answers still gets the wipe
 * attempt, and anything left is retried by the cleanup flag. The outcome is
 * kept in sessionStorage for diagnostics and the sign-out e2e.
 */
export async function shutDownAndWipeReaderStores({
  store,
  origin,
  siteSlug,
  sessionStorage,
  shutdownTimeoutMs = 3000,
  storage,
}: {
  store?: { shutdown: () => Promise<void> } | null;
  origin: string;
  siteSlug: string | null | undefined;
  sessionStorage?: Pick<Storage, "setItem">;
  shutdownTimeoutMs?: number;
  storage?: StorageManager;
}) {
  markSigningOut();
  if (store) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      store.shutdown().catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, shutdownTimeoutMs); }),
    ]);
    clearTimeout(timer);
  }
  const result = await wipeReaderStoresOnSignOut({ origin, siteSlug, ...(storage ? { storage } : {}) })
    .catch((): SignOutWipeResult => ({ target: siteSlug ? "site" : "all", retired: [], failed: ["*"] }));
  try { sessionStorage?.setItem(SIGN_OUT_WIPE_KEY, JSON.stringify({ ...result, at: Date.now() })); } catch { /* Diagnostic only. */ }
  return result;
}
