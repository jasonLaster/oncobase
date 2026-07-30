import {
  makePublicWikiSessionIdentity,
  parseWikiSessionIdentity,
  type WikiSessionIdentity,
  WIKI_SESSION_CACHE_VERSION,
} from "@oncobase/wiki-content";

const PUBLIC_IDENTITY_KEY_PREFIX = "wiki-vite-public-identity";

export function publicIdentityStorageKey(partition: string) {
  return `${PUBLIC_IDENTITY_KEY_PREFIX}:${WIKI_SESSION_CACHE_VERSION}:${partition}`;
}

function isPublicIdentity(identity: WikiSessionIdentity) {
  return (
    identity.scope === "public" &&
    identity.authenticated === false &&
    identity.userHash === null &&
    identity.cacheVersion === WIKI_SESSION_CACHE_VERSION
  );
}

export function readPersistedPublicIdentity(
  storage: Pick<Storage, "getItem">,
  partition: string,
): WikiSessionIdentity | null {
  try {
    const serialized = storage.getItem(publicIdentityStorageKey(partition));
    if (!serialized) return null;
    const identity = parseWikiSessionIdentity(JSON.parse(serialized));
    return isPublicIdentity(identity) ? identity : null;
  } catch {
    return null;
  }
}

export function persistPublicIdentity(
  storage: Pick<Storage, "setItem">,
  partition: string,
  identity: WikiSessionIdentity,
) {
  if (!isPublicIdentity(identity)) return;
  try {
    storage.setItem(publicIdentityStorageKey(partition), JSON.stringify(identity));
  } catch {
    // Identity persistence is an availability optimization, never a reason to
    // reject a valid identity response.
  }
}

export function resolvePublicIdentityFallback({
  storage,
  partition,
  configuredSiteSlug,
}: {
  storage: Pick<Storage, "getItem">;
  partition: string;
  configuredSiteSlug?: string;
}) {
  const persisted = readPersistedPublicIdentity(storage, partition);
  if (persisted) return persisted;
  const siteSlug = configuredSiteSlug?.trim();
  return siteSlug ? makePublicWikiSessionIdentity(siteSlug) : null;
}
