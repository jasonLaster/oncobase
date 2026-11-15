import { expandCompactFileTree, parseWikiManifest, transformFileTreeForSidebar, WIKI_MANIFEST_SCHEMA_VERSION, WIKI_READER_CACHE_VERSION, type FileNode, type WikiSessionIdentity } from "@oncobase/wiki-content";
import type { PageContentRow, PageIndexRow } from "../types";
import { contentSlugFromRouteSlug, slugFromPath } from "../wiki-utils";
import { BOOTSTRAP_MAX_AGE_MS, NAVIGATION_BOOTSTRAP_ID, PAGE_BOOTSTRAP_ID, pageBootstrapFor, parseBootstrapJson } from "./page-payload";

type RequestPartition = { origin: string; pathname: string; apiOrigin: string; siteSlug: string };

/**
 * The navigation slice a document carries (top level plus the current page's
 * ancestors), for the store's identity: a public slice for any reader of this
 * site and request, a session slice only for the exact identity it was
 * produced for (same cache key). The full manifest replaces it once synced.
 */
export function parseNavigationBootstrap(raw: string, request: RequestPartition, identity?: WikiSessionIdentity | null): FileNode[] | null {
  if (raw.length > 1_048_576 || request.origin !== request.apiOrigin) return null;
  try {
    const value = parseBootstrapJson(raw) as Record<string, unknown>;
    if (value.version !== 1 || value.readerVersion !== WIKI_READER_CACHE_VERSION ||
        value.origin !== request.origin || value.pathname !== request.pathname ||
        value.siteSlug !== request.siteSlug) return null;
    if (value.scope === "session") {
      if (identity?.scope !== "session" || value.identityKey !== identity.cacheKey) return null;
    } else if (value.scope !== "public") return null;
    const { compactTree } = parseWikiManifest({ schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION,
      siteSlug: value.siteSlug, scope: value.scope, manifestHash: "", generatedAt: "",
      pages: [], assets: [], compactTree: value.tree });
    return transformFileTreeForSidebar(expandCompactFileTree(compactTree));
  } catch { return null; }
}

export type InitialReaderData = {
  cachedBodies?: Record<string, PageContentRow>;
  page: PageContentRow;
  index: PageIndexRow;
  pages: PageIndexRow[];
  tree: FileNode[];
  /** The whole site's tree (a startup snapshot), not the document's slice of top level plus ancestors. */
  treeComplete?: boolean;
  expiresAt: number;
};

export function initialReaderPage(initial: InitialReaderData | null, slug: string) {
  return initial?.cachedBodies?.[slug] ?? (initial?.page.slug === slug ? initial.page : null);
}

/** `identity` selects which payload may present: a public page for anyone, a
 * session page only for the identity it was produced for. */
export function initialReaderData(raw: string, receivedAt: number, request: RequestPartition,
  navigation: string | null = null, now = Date.now(), identity: WikiSessionIdentity | null = null): InitialReaderData | null {
  if (!Number.isFinite(receivedAt) || now < receivedAt || now - receivedAt > BOOTSTRAP_MAX_AGE_MS) return null;
  const page = identity ? pageBootstrapFor(raw, request, identity)
    : pageBootstrapFor(raw, request, { siteSlug: request.siteSlug, scope: "public", authenticated: false, cacheKey: "", cacheVersion: "", userHash: null });
  if (!page || page.slug !== contentSlugFromRouteSlug(slugFromPath(request.pathname))) return null;
  const index: PageIndexRow = { slug: page.slug, title: page.title, tagsJson: JSON.stringify(page.tags),
    contentHash: page.contentHash, description: null, sensitive: page.sensitive, size: page.size };
  return {
    page: { ...index, content: page.content, expectedContentHash: page.contentHash,
      contentStatus: "fresh", fetchedAt: receivedAt, missingAt: null, staleAt: null, deletedAt: null },
    index, pages: [index], tree: navigation ? parseNavigationBootstrap(navigation, request, identity) ?? [] : [],
    expiresAt: receivedAt + BOOTSTRAP_MAX_AGE_MS,
  };
}

/** Read once from this response without consuming the data
 * needed by the real LiveStore boot. No persisted body or identity is read. */
export function readInitialReaderData(identity: WikiSessionIdentity): InitialReaderData | null {
  const url = new URL(location.href);
  // Retain the previous provider-gated path for controlled comparisons.
  if (url.searchParams.get("readerBootstrap") === "0") return null;
  const node = document.getElementById(PAGE_BOOTSTRAP_ID);
  if (!node) return null;
  const navigation = document.getElementById(NAVIGATION_BOOTSTRAP_ID);
  const now = Date.now();
  const navigationAge = now - Number(navigation?.dataset.receivedAt);
  return initialReaderData(node.textContent ?? "", Number(node.dataset.receivedAt), {
    origin: location.origin, pathname: location.pathname, siteSlug: identity.siteSlug,
    apiOrigin: new URL(import.meta.env.VITE_WIKI_API_ORIGIN || location.origin, location.origin).origin,
  }, navigation && Number.isFinite(navigationAge) && navigationAge >= 0 && navigationAge <= BOOTSTRAP_MAX_AGE_MS
    ? navigation.textContent : null, now, identity);
}
