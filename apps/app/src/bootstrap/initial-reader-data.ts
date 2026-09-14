import { expandCompactFileTree, parseWikiManifest, transformFileTreeForSidebar, WIKI_MANIFEST_SCHEMA_VERSION, WIKI_READER_CACHE_VERSION, type FileNode, type WikiSessionIdentity } from "@oncobase/wiki-content";
import type { PageContentRow, PageIndexRow } from "../types";
import { contentSlugFromRouteSlug, slugFromPath } from "../wiki-utils";
import { parsePageBootstrap, PAGE_BOOTSTRAP_ID } from "./page-payload";

type RequestPartition = { origin: string; pathname: string; apiOrigin: string; siteSlug: string };

export function parseNavigationBootstrap(raw: string, request: RequestPartition): FileNode[] | null {
  if (raw.length > 1_048_576 || request.origin !== request.apiOrigin) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.readerVersion !== WIKI_READER_CACHE_VERSION ||
        value.origin !== request.origin || value.pathname !== request.pathname ||
        value.siteSlug !== request.siteSlug || value.scope !== "public") return null;
    const { compactTree } = parseWikiManifest({ schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION,
      siteSlug: value.siteSlug, scope: "public", manifestHash: "", generatedAt: "",
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
  expiresAt: number;
};

export function initialReaderPage(initial: InitialReaderData | null, slug: string) {
  return initial?.cachedBodies?.[slug] ?? (initial?.page.slug === slug ? initial.page : null);
}

export function initialReaderData(raw: string, receivedAt: number, request: RequestPartition,
  navigation: string | null = null, now = Date.now()): InitialReaderData | null {
  if (!Number.isFinite(receivedAt) || now < receivedAt || now - receivedAt > 60_000) return null;
  const payload = parsePageBootstrap(raw, request);
  if (!payload || payload.page.slug !== contentSlugFromRouteSlug(slugFromPath(request.pathname))) return null;
  const page = payload.page;
  const index: PageIndexRow = { slug: page.slug, title: page.title, tagsJson: JSON.stringify(page.tags),
    contentHash: page.contentHash, description: null, sensitive: false, size: page.size };
  return {
    page: { ...index, content: page.content!, expectedContentHash: page.contentHash,
      contentStatus: "fresh", fetchedAt: receivedAt, missingAt: null, staleAt: null, deletedAt: null },
    index, pages: [index], tree: navigation ? parseNavigationBootstrap(navigation, request) ?? [] : [],
    expiresAt: receivedAt + 60_000,
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
  const navigation = document.getElementById("wiki-navigation-bootstrap");
  const now = Date.now();
  const navigationAge = now - Number(navigation?.dataset.receivedAt);
  return initialReaderData(node.textContent ?? "", Number(node.dataset.receivedAt), {
    origin: location.origin, pathname: location.pathname, siteSlug: identity.siteSlug,
    apiOrigin: new URL(import.meta.env.VITE_WIKI_API_ORIGIN || location.origin, location.origin).origin,
  }, navigation && Number.isFinite(navigationAge) && navigationAge >= 0 && navigationAge <= 60_000
    ? navigation.textContent : null, now);
}
