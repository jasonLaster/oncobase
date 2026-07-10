import { headers } from "next/headers";
import { cacheLife, cacheTag } from "next/cache";
import {
  canonicalizePublishedSlug,
  canonicalSlugLookupEntriesFromSlugs,
  legacyPublishedSlug,
} from "@oncobase/wiki-content/canonical-slugs";
import { siteDataFromSlug } from "@/lib/site-data";
import { DEFAULT_SITE_SLUG, toSiteSlug, type SiteSlug } from "@/lib/site";
import { shouldSkipConvexReads } from "@/lib/convex-url";
import {
  buildCompactTreeFromManifest,
  expandCompactFileTree,
  groupFileTreeCollectionsDeep,
  sortTree,
  transformFileTreeForSidebar,
  type CompactFileNode,
  type FileNode,
} from "@/lib/file-tree-compact";
import {
  pruneFileTreeForShell,
  type ShellFileTreeOptions,
} from "@/lib/file-tree-shell";
import { isHiddenFileTreeAssetPath, isHiddenFileTreePath } from "@/lib/file-tree-paths";
import {
  siteAssetsCacheTag,
  siteCacheTag,
  siteDocCacheTag,
  siteDocsCacheTag,
  siteTagsCacheTag,
  siteTreeCacheTag,
} from "@/lib/wiki-cache-tags";

// Resolve the active site from the proxy-set `x-site-slug` header.
async function readSiteSlug(): Promise<SiteSlug> {
  try {
    const h = await headers();
    return toSiteSlug(h.get("x-site-slug") ?? DEFAULT_SITE_SLUG);
  } catch {
    return toSiteSlug(DEFAULT_SITE_SLUG);
  }
}

// All reads route through Convex. The publisher CLI in
// `apps/web/scripts/publish/` is the only producer of this data; the
// runtime never touches the filesystem. See:
// - plans/multi-tenant-wiki/01-content-source.md
// - apps/web/specs/multi-site.md

export type { CompactFileNode, FileNode };
export {
  groupFileTreeCollectionsDeep,
  isHiddenFileTreeAssetPath,
  isHiddenFileTreePath,
  sortTree,
};

export interface MarkdownFile {
  slug: string;
  title: string;
  content: string;
  contentHash?: string;
  sensitive?: boolean;
  frontmatter: Record<string, unknown>;
}

export interface MarkdownManifest {
  slug: string;
  title: string;
  contentHash?: string;
  sensitive?: boolean;
  frontmatter: Record<string, unknown>;
}

export interface PageEntry {
  name: string;
  slug: string;
  path: string;
}

export interface ResolvedMarkdownRoute {
  canonicalSlug: string | null;
  file: MarkdownFile | null;
}

export interface ResolvedMarkdownManifestRoute {
  canonicalSlug: string | null;
  manifest: MarkdownManifest | null;
}

interface MarkdownReadOptions {
  // Public reads use Convex's redacted `content`. Admin page rendering
  // may pass a session token hash so Convex can verify admin status
  // before returning raw markdown.
  includeSensitive?: boolean;
  rawContentSessionTokenHash?: string;
}

interface MarkdownDiscoveryOptions {
  includeSensitive?: boolean;
}

const CANONICAL_SLUG_LOOKUP_VERSION = "2";

export { canonicalizePublishedSlug, canonicalSlugLookupEntriesFromSlugs };

// ── Convex fetchers (tagged Cache Components entries) ────────────────────────
// Publish invalidates these tags so the PPR shell, document body, and sidebar
// tree all observe Convex updates without falling back to uncached rendering.

async function fetchAllDocsForSite(
  siteSlug: SiteSlug,
  includeSensitive = false,
): Promise<Array<{ slug: string; title: string; tags: string[] }>> {
  "use cache";
  cacheLife("hours");
  cacheTag(siteCacheTag(siteSlug), siteDocsCacheTag(siteSlug));

  if (shouldSkipConvexReads()) return [];
  return await siteDataFromSlug(siteSlug).documents.list(
    includeSensitive ? { includeSensitive: true } : {},
  );
}

async function fetchAllDocs() {
  return fetchAllDocsForSite(await readSiteSlug());
}

async function paginateAssetPaths(
  fetchPage: (args: { cursor: string | null; numItems: number }) => Promise<{
    page: string[];
    isDone: boolean;
    continueCursor: string;
  }>,
): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const result = await fetchPage({ cursor, numItems: 1000 });
    out.push(...result.page);
    isDone = result.isDone;
    cursor = result.continueCursor;
  }
  return out;
}

async function fetchAllPdfPathsForSite(
  siteSlug: SiteSlug,
  includeSensitive = false,
): Promise<string[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteAssetsCacheTag(siteSlug),
    siteTreeCacheTag(siteSlug),
  );

  if (shouldSkipConvexReads()) return [];
  const siteData = siteDataFromSlug(siteSlug);
  try {
    return await paginateAssetPaths((args) =>
      siteData.documents.listPdfAssetPathsPage(
        includeSensitive ? { ...args, includeSensitive: true } : args,
      ),
    );
  } catch (error) {
    console.warn(
      "[markdown] Falling back to legacy PDF asset listing",
      error,
    );
    const assets = await siteData.documents.listPdfAssets();
    return assets.map((asset: { path: string }) => asset.path);
  }
}

async function fetchAllFilePathsForSite(
  siteSlug: SiteSlug,
  includeSensitive = false,
): Promise<string[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteAssetsCacheTag(siteSlug),
    siteTreeCacheTag(siteSlug),
  );

  if (shouldSkipConvexReads()) return [];
  const siteData = siteDataFromSlug(siteSlug);
  try {
    return await paginateAssetPaths((args) =>
      siteData.documents.listFileAssetPathsPage(
        includeSensitive ? { ...args, includeSensitive: true } : args,
      ),
    );
  } catch (error) {
    console.warn(
      "[markdown] Falling back to legacy file asset listing",
      error,
    );
    const assets = await siteData.documents.listFileAssets();
    return assets.map((asset: { path: string }) => asset.path);
  }
}

async function fetchCanonicalSlugEntriesForSite(
  siteSlug: SiteSlug,
  includeSensitive = false,
  lookupVersion = CANONICAL_SLUG_LOOKUP_VERSION,
): Promise<Array<[string, string]>> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    `${siteDocsCacheTag(siteSlug)}:canonical-slugs:${lookupVersion}`,
  );

  const docs = await fetchAllDocsForSite(siteSlug, includeSensitive);
  return canonicalSlugLookupEntriesFromSlugs(docs.map((doc) => doc.slug));
}

async function fetchCanonicalSlugMapForSite(
  siteSlug: SiteSlug,
  includeSensitive = false,
): Promise<Map<string, string>> {
  return new Map(
    await fetchCanonicalSlugEntriesForSite(
      siteSlug,
      includeSensitive,
      CANONICAL_SLUG_LOOKUP_VERSION,
    ),
  );
}

async function fetchCanonicalSlugMap({
  includeSensitive = false,
}: MarkdownDiscoveryOptions = {}): Promise<Map<string, string>> {
  return fetchCanonicalSlugMapForSite(await readSiteSlug(), includeSensitive);
}

// ── Public API ───────────────────────────────────────────────────────────────

function toMarkdownFrontmatter(doc: {
  tags?: string[];
  description?: string | null;
  sensitive?: boolean;
}): Record<string, unknown> {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const frontmatter: Record<string, unknown> = { tags };
  if (doc.description) frontmatter.description = doc.description;
  if (doc.sensitive) frontmatter.sensitive = true;
  return frontmatter;
}

export async function getMarkdownFileForSite(
  siteSlug: SiteSlug,
  slug: string,
  {
    includeSensitive = false,
    rawContentSessionTokenHash,
  }: MarkdownReadOptions = {},
): Promise<MarkdownFile | null> {
  if (rawContentSessionTokenHash) {
    return readMarkdownFileForSite(siteSlug, slug, {
      includeSensitive,
      rawContentSessionTokenHash,
    });
  }
  return fetchMarkdownFileForSite(siteSlug, slug, includeSensitive);
}

async function fetchMarkdownFileForSite(
  siteSlug: SiteSlug,
  slug: string,
  includeSensitive: boolean,
): Promise<MarkdownFile | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteDocCacheTag(siteSlug, slug),
  );

  return await readMarkdownFileForSite(siteSlug, slug, { includeSensitive });
}

export async function readMarkdownFileForSite(
  siteSlug: SiteSlug,
  slug: string,
  {
    includeSensitive = false,
    rawContentSessionTokenHash,
  }: MarkdownReadOptions = {},
): Promise<MarkdownFile | null> {
  if (shouldSkipConvexReads()) return null;
  const siteData = siteDataFromSlug(siteSlug);
  let doc = await siteData.documents.getBySlug(
    {
      slug,
      ...(includeSensitive ? { includeSensitive: true } : {}),
      ...(rawContentSessionTokenHash ? { rawContentSessionTokenHash } : {}),
    },
  );
  if (!doc) {
    const indexSlug = `${slug}/index`;
    doc = await siteData.documents.getBySlug(
      {
        slug: indexSlug,
        ...(includeSensitive ? { includeSensitive: true } : {}),
        ...(rawContentSessionTokenHash ? { rawContentSessionTokenHash } : {}),
      },
    );
  }
  const legacySlug = legacyPublishedSlug(slug);
  if (!doc && legacySlug) {
    doc = await siteData.documents.getBySlug(
      {
        slug: legacySlug,
        ...(includeSensitive ? { includeSensitive: true } : {}),
        ...(rawContentSessionTokenHash ? { rawContentSessionTokenHash } : {}),
      },
    );
  }
  if (!doc) return null;
  const resolvedSlug = legacySlug && doc.slug === legacySlug ? slug : doc.slug;

  return {
    slug: canonicalizePublishedSlug(resolvedSlug),
    title: doc.title,
    content: doc.content,
    contentHash: doc.contentHash,
    sensitive: doc.sensitive,
    frontmatter: toMarkdownFrontmatter(doc),
  };
}

export async function getMarkdownManifestForSite(
  siteSlug: SiteSlug,
  slug: string,
  { includeSensitive = false }: MarkdownReadOptions = {},
): Promise<MarkdownManifest | null> {
  return fetchMarkdownManifestForSite(siteSlug, slug, includeSensitive);
}

async function fetchMarkdownManifestForSite(
  siteSlug: SiteSlug,
  slug: string,
  includeSensitive: boolean,
): Promise<MarkdownManifest | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteDocCacheTag(siteSlug, slug),
  );

  return await readMarkdownManifestForSite(siteSlug, slug, { includeSensitive });
}

export async function readMarkdownManifestForSite(
  siteSlug: SiteSlug,
  slug: string,
  { includeSensitive = false }: MarkdownReadOptions = {},
): Promise<MarkdownManifest | null> {
  if (shouldSkipConvexReads()) return null;
  const siteData = siteDataFromSlug(siteSlug);
  let doc: {
    slug: string;
    title: string;
    tags?: string[];
    description?: string | null;
    contentHash?: string;
    sensitive?: boolean;
  } | null = null;

  try {
    doc = await siteData.documents.getManifestBySlug(
      includeSensitive ? { slug, includeSensitive: true } : { slug },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Server Error|Unknown function|Could not find public function/i.test(message)) {
      throw error;
    }

    const fallbackDoc = await siteData.documents.getBySlug(
      includeSensitive ? { slug, includeSensitive: true } : { slug },
    );
    if (fallbackDoc) {
      doc = {
        slug: fallbackDoc.slug,
        title: fallbackDoc.title,
        tags: fallbackDoc.tags,
        description: fallbackDoc.description,
        contentHash: fallbackDoc.contentHash,
        sensitive: fallbackDoc.sensitive,
      };
    }
  }
  if (!doc) return null;

  return {
    slug: canonicalizePublishedSlug(doc.slug),
    title: doc.title,
    contentHash: doc.contentHash,
    sensitive: doc.sensitive,
    frontmatter: toMarkdownFrontmatter(doc),
  };
}

/** Read a single markdown row by slug, falling back to `<slug>/index`. */
export async function getMarkdownFile(
  slug: string,
  opts: MarkdownReadOptions = {},
): Promise<MarkdownFile | null> {
  return readMarkdownFileForSite(await readSiteSlug(), slug, opts);
}

/** Async variant — kept as an alias for callers that use the explicit name. */
export const getMarkdownFileAsync = getMarkdownFile;

/** Build the compact sidebar file tree from Convex documents + assets. */
export async function getCompactFileTreeForSite(
  siteSlug: SiteSlug,
  { includeSensitive = false }: MarkdownDiscoveryOptions = {},
): Promise<CompactFileNode[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteAssetsCacheTag(siteSlug),
    siteTreeCacheTag(siteSlug),
  );

  const [docs, pdfPaths, filePaths] = await Promise.all([
    fetchAllDocsForSite(siteSlug, includeSensitive),
    fetchAllPdfPathsForSite(siteSlug, includeSensitive),
    fetchAllFilePathsForSite(siteSlug, includeSensitive),
  ]);

  return buildCompactTreeFromManifest(
    docs.map((doc) => ({ slug: canonicalizePublishedSlug(doc.slug) })),
    [
      ...pdfPaths.map((path) => ({ kind: "pdf" as const, path })),
      ...filePaths.map((path) => ({ kind: "file" as const, path })),
    ],
  );
}

/** Build the sidebar file tree from Convex documents + assets. */
export async function getFileTreeForSite(
  siteSlug: SiteSlug,
  options: MarkdownDiscoveryOptions = {},
): Promise<FileNode[]> {
  return transformFileTreeForSidebar(
    expandCompactFileTree(await getCompactFileTreeForSite(siteSlug, options)),
  );
}

/** Build a shallow cached tree for the server-rendered wiki shell. */
export async function getShellFileTreeForSite(
  siteSlug: SiteSlug,
  options: ShellFileTreeOptions = {},
): Promise<FileNode[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteAssetsCacheTag(siteSlug),
    siteTreeCacheTag(siteSlug),
  );

  return pruneFileTreeForShell(await getFileTreeForSite(siteSlug), options);
}

export async function getFileTree(
  options: MarkdownDiscoveryOptions = {},
): Promise<FileNode[]> {
  return getFileTreeForSite(await readSiteSlug(), options);
}

/** Convex documents already include PDFs in their own table — single fetch. */
export const getFileTreeWithPdfs = getFileTree;

export async function getAllSlugs({
  includeSensitive = false,
}: MarkdownDiscoveryOptions = {}): Promise<string[]> {
  const docs = includeSensitive
    ? await fetchAllDocsForSite(await readSiteSlug(), true)
    : await fetchAllDocs();
  return docs.map((d) => d.slug);
}

export async function getAllPageEntries(): Promise<PageEntry[]> {
  return getAllPageEntriesForSite(await readSiteSlug());
}

export async function getAllPageEntriesForSite(
  siteSlug: SiteSlug,
  { includeSensitive = false }: MarkdownDiscoveryOptions = {},
): Promise<PageEntry[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(siteCacheTag(siteSlug), siteDocsCacheTag(siteSlug));

  const docs = await fetchAllDocsForSite(siteSlug, includeSensitive);
  return docs.map((doc) => {
    const segments = doc.slug.split("/");
    const name = segments.at(-1) ?? doc.slug;
    return {
      name,
      slug: doc.slug,
      path: segments.join(" / "),
    };
  });
}

export async function getCanonicalSlug(
  slug: string,
  { includeSensitive = false }: MarkdownDiscoveryOptions = {},
): Promise<string | null> {
  const map = await fetchCanonicalSlugMap({ includeSensitive });
  return map.get(slug.toLowerCase()) ?? null;
}

export async function getCanonicalSlugForSite(
  siteSlug: SiteSlug,
  slug: string,
  { includeSensitive = false }: MarkdownDiscoveryOptions = {},
): Promise<string | null> {
  const map = await fetchCanonicalSlugMapForSite(siteSlug, includeSensitive);
  return map.get(slug.toLowerCase()) ?? null;
}

export async function resolveMarkdownRouteForSite(
  siteSlug: SiteSlug,
  slug: string,
  opts: MarkdownReadOptions = {},
): Promise<ResolvedMarkdownRoute> {
  const file = await getMarkdownFileForSite(siteSlug, slug, opts);
  if (file || slug === "index") {
    return { canonicalSlug: null, file };
  }

  const canonicalSlug = await getCanonicalSlugForSite(siteSlug, slug, opts);
  if (!canonicalSlug) {
    return { canonicalSlug: null, file: null };
  }

  return {
    canonicalSlug,
    file: await getMarkdownFileForSite(siteSlug, canonicalSlug, opts),
  };
}

export async function resolveMarkdownManifestRouteForSite(
  siteSlug: SiteSlug,
  slug: string,
  opts: MarkdownReadOptions = {},
): Promise<ResolvedMarkdownManifestRoute> {
  const manifest = await getMarkdownManifestForSite(siteSlug, slug, opts);
  if (manifest || slug === "index") {
    return { canonicalSlug: null, manifest };
  }

  const canonicalSlug = await getCanonicalSlugForSite(siteSlug, slug, opts);
  if (!canonicalSlug) {
    return { canonicalSlug: null, manifest: null };
  }

  return {
    canonicalSlug,
    manifest: await getMarkdownManifestForSite(siteSlug, canonicalSlug, opts),
  };
}

async function getAllTagsForSite(siteSlug: SiteSlug): Promise<string[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteTagsCacheTag(siteSlug),
  );

  if (shouldSkipConvexReads()) return [];
  const tags = await siteDataFromSlug(siteSlug).documents.listTags();
  return tags
    .map((t: string) => t.toLowerCase())
    .sort((a: string, b: string) => a.localeCompare(b));
}

export async function getAllTags(): Promise<string[]> {
  return getAllTagsForSite(await readSiteSlug());
}

async function getPagesByTagForSite(
  siteSlug: SiteSlug,
  tag: string,
): Promise<Array<{ slug: string; title: string; sensitive?: boolean }>> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteTagsCacheTag(siteSlug),
  );

  if (shouldSkipConvexReads()) return [];
  // Convex `getByTag` matches case-sensitively; tags are lowercased at
  // publish time, so the lookup just needs the normalized form.
  return await siteDataFromSlug(siteSlug).documents.getByTag({
    tag: tag.toLowerCase(),
  });
}

async function getPagesByTagIncludingSensitiveForSite(
  siteSlug: SiteSlug,
  tag: string,
): Promise<Array<{ slug: string; title: string; sensitive?: boolean }>> {
  if (shouldSkipConvexReads()) return [];
  const docs = await siteDataFromSlug(siteSlug).documents.list({
    includeSensitive: true,
  });
  const normalizedTag = tag.toLowerCase();
  return docs
    .filter((doc) => doc.tags.includes(normalizedTag))
    .map(({ slug, title, sensitive }) => ({ slug, title, sensitive }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getPagesByTag(
  tag: string,
  options: MarkdownDiscoveryOptions = {},
): Promise<Array<{ slug: string; title: string; sensitive?: boolean }>> {
  const siteSlug = await readSiteSlug();
  if (options.includeSensitive) {
    return getPagesByTagIncludingSensitiveForSite(siteSlug, tag);
  }
  return getPagesByTagForSite(siteSlug, tag);
}
