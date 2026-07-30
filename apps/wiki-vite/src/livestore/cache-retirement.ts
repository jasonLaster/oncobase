import {
  makeWikiStoreId,
  type WikiScope,
  type WikiSessionIdentity,
  WIKI_PREVIOUS_READER_CACHE_VERSION,
} from "@oncobase/wiki-content";
import type { PageContentRow, SiteStateRow } from "../types";
import { WIKI_CACHE_SCHEMA_VERSION } from "./schema";

type DirectoryWithKeys = FileSystemDirectoryHandle & {
  keys: () => AsyncIterableIterator<string>;
};

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
    state?.schemaVersion === WIKI_CACHE_SCHEMA_VERSION &&
      state.siteSlug === identity.siteSlug &&
      state.scope === scope &&
      state.manifestHash &&
      state.lastValidatedAt > 0 &&
      page?.fetchedAt &&
      page.contentStatus === "fresh" &&
      page.deletedAt === null &&
      page.missingAt === null &&
      page.contentHash === page.expectedContentHash,
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
