import {
  makeWikiStoreId,
  type WikiScope,
  type WikiSessionIdentity,
  WIKI_PREVIOUS_READER_CACHE_VERSION,
  WIKI_READER_CACHE_VERSION,
} from "@oncobase/wiki-content";
import type { PageContentRow, PageIndexRow, SiteStateRow } from "../types";
import { WIKI_CACHE_SCHEMA_VERSION } from "./schema";

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
  const directory = await storage?.getDirectory?.();
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
  const directory = await storage?.getDirectory?.();
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
