import { headers } from "next/headers";
import { cacheLife, cacheTag } from "next/cache";
import { siteDataFromSlug } from "@/lib/site-data";
import { DEFAULT_SITE_SLUG, toSiteSlug, type SiteSlug } from "@/lib/site";
import { shouldSkipConvexReads } from "@/lib/convex-url";
import type { PiiRedactionMode } from "@/lib/pii-redaction";
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
// `web/scripts/publish/` is the only producer of this data; the
// runtime never touches the filesystem. See:
// - plans/multi-tenant-wiki/01-content-source.md
// - web/specs/multi-site.md

export interface FileNode {
  name: string;
  slug: string;
  type: "file" | "directory" | "pdf";
  badge?: string;
  /** Asset path within the site's vault — only set for type === "pdf" */
  pdfPath?: string;
  children?: FileNode[];
}

export interface MarkdownFile {
  slug: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface PageEntry {
  name: string;
  slug: string;
  path: string;
}

interface MarkdownReadOptions {
  // Convex stores content already redacted at publish time, so the
  // mode here is informational. The reveal path is gone with the fs
  // reader — raw markdown lives only in the publisher's local vault.
  piiMode?: PiiRedactionMode;
}

const HIDDEN_FILE_TREE_DIRECTORIES = new Set(["images"]);

export function isHiddenFileTreePath(path: string): boolean {
  return path.split("/").some((segment) => HIDDEN_FILE_TREE_DIRECTORIES.has(segment));
}

// ── Convex fetchers (tagged Cache Components entries) ────────────────────────
// Publish invalidates these tags so the PPR shell, document body, and sidebar
// tree all observe Convex updates without falling back to uncached rendering.

async function fetchAllDocsForSite(
  siteSlug: SiteSlug,
): Promise<Array<{ slug: string; title: string; tags: string[] }>> {
  "use cache";
  cacheLife("hours");
  cacheTag(siteCacheTag(siteSlug), siteDocsCacheTag(siteSlug));

  if (shouldSkipConvexReads()) return [];
  return await siteDataFromSlug(siteSlug).documents.list();
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

async function fetchAllPdfPathsForSite(siteSlug: SiteSlug): Promise<string[]> {
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
      siteData.documents.listPdfAssetPathsPage(args),
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

async function fetchAllFilePathsForSite(siteSlug: SiteSlug): Promise<string[]> {
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
      siteData.documents.listFileAssetPathsPage(args),
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
): Promise<Array<[string, string]>> {
  "use cache";
  cacheLife("hours");
  cacheTag(siteCacheTag(siteSlug), siteDocsCacheTag(siteSlug));

  const docs = await fetchAllDocsForSite(siteSlug);
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const lower = doc.slug.toLowerCase();
    if (!seen.has(lower)) {
      entries.push([lower, doc.slug]);
      seen.add(lower);
    }
  }
  return entries;
}

async function fetchCanonicalSlugMapForSite(
  siteSlug: SiteSlug,
): Promise<Map<string, string>> {
  return new Map(await fetchCanonicalSlugEntriesForSite(siteSlug));
}

async function fetchCanonicalSlugMap(): Promise<Map<string, string>> {
  return fetchCanonicalSlugMapForSite(await readSiteSlug());
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getMarkdownFileForSite(
  siteSlug: SiteSlug,
  slug: string,
): Promise<MarkdownFile | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteDocCacheTag(siteSlug, slug),
  );

  if (shouldSkipConvexReads()) return null;
  const siteData = siteDataFromSlug(siteSlug);
  let doc = await siteData.documents.getBySlug({ slug });
  if (!doc) {
    doc = await siteData.documents.getBySlug({ slug: `${slug}/index` });
  }
  if (!doc) return null;

  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const frontmatter: Record<string, unknown> = { tags };
  if (doc.description) frontmatter.description = doc.description;

  return {
    slug: doc.slug,
    title: doc.title,
    content: doc.content,
    frontmatter,
  };
}

/** Read a single markdown row by slug, falling back to `<slug>/index`. */
export async function getMarkdownFile(
  slug: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: MarkdownReadOptions = {},
): Promise<MarkdownFile | null> {
  return getMarkdownFileForSite(await readSiteSlug(), slug);
}

/** Async variant — kept as an alias for callers that use the explicit name. */
export const getMarkdownFileAsync = getMarkdownFile;

/** Build the sidebar file tree from Convex documents + assets. */
export async function getFileTreeForSite(siteSlug: SiteSlug): Promise<FileNode[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteAssetsCacheTag(siteSlug),
    siteTreeCacheTag(siteSlug),
  );

  const [docs, pdfPaths, filePaths] = await Promise.all([
    fetchAllDocsForSite(siteSlug),
    fetchAllPdfPathsForSite(siteSlug),
    fetchAllFilePathsForSite(siteSlug),
  ]);

  const root: FileNode[] = [];

  for (const doc of docs) {
    insertSlug(root, doc.slug, "file");
  }
  for (const pdfPath of pdfPaths) {
    if (isHiddenFileTreePath(pdfPath)) continue;
    insertPdf(root, pdfPath);
  }
  for (const filePath of filePaths) {
    if (isHiddenFileTreePath(filePath)) continue;
    insertSlug(root, filePath, "file");
  }

  const grouped = groupPaperCollectionsDeep(root);
  sortTree(grouped);
  return grouped;
}

export async function getFileTree(): Promise<FileNode[]> {
  return getFileTreeForSite(await readSiteSlug());
}

/** Convex documents already include PDFs in their own table — single fetch. */
export const getFileTreeWithPdfs = getFileTree;

export async function getAllSlugs(): Promise<string[]> {
  const docs = await fetchAllDocs();
  return docs.map((d) => d.slug);
}

export async function getAllPageEntries(): Promise<PageEntry[]> {
  return getAllPageEntriesForSite(await readSiteSlug());
}

export async function getAllPageEntriesForSite(
  siteSlug: SiteSlug,
): Promise<PageEntry[]> {
  const docs = await fetchAllDocsForSite(siteSlug);
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

export async function getCanonicalSlug(slug: string): Promise<string | null> {
  const map = await fetchCanonicalSlugMap();
  return map.get(slug.toLowerCase()) ?? null;
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
): Promise<Array<{ slug: string; title: string }>> {
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

export async function getPagesByTag(
  tag: string,
): Promise<Array<{ slug: string; title: string }>> {
  return getPagesByTagForSite(await readSiteSlug(), tag);
}

// ── Tree construction ────────────────────────────────────────────────────────

function ensureDirectory(
  parent: FileNode[],
  segments: string[],
  pathSoFar: string[],
): FileNode[] {
  if (segments.length === 0) return parent;
  const [head, ...rest] = segments;
  const slug = [...pathSoFar, head].join("/");
  let dir = parent.find((n) => n.type === "directory" && n.name === head);
  if (!dir) {
    dir = { name: head, slug, type: "directory", children: [] };
    parent.push(dir);
  }
  if (!dir.children) dir.children = [];
  return ensureDirectory(dir.children, rest, [...pathSoFar, head]);
}

function insertSlug(root: FileNode[], slug: string, type: "file") {
  const segments = slug.split("/");
  const fileName = segments.pop()!;
  const dir = ensureDirectory(root, segments, []);
  if (dir.find((n) => n.slug === slug)) return;
  dir.push({ name: fileName, slug, type });
}

function insertPdf(root: FileNode[], pdfPath: string) {
  const segments = pdfPath.split("/");
  const fileName = segments.pop()!;
  const nameWithoutExt = fileName.replace(/\.pdf$/i, "");
  const dir = ensureDirectory(root, segments, []);
  if (dir.find((n) => n.type === "pdf" && n.pdfPath === pdfPath)) return;
  dir.push({
    name: nameWithoutExt,
    slug: pdfPath,
    type: "pdf",
    pdfPath,
  });
}

// ── Paper-collection grouping (carried over from the fs-backed version) ───────

type CollectionPart = "markdown" | "analysis" | "pdf";

function getCollectionPart(
  node: FileNode,
): { baseName: string; part: CollectionPart } | null {
  if (node.type === "pdf") return { baseName: node.name, part: "pdf" };
  if (node.type !== "file") return null;
  if (node.name.endsWith("-analysis")) {
    return { baseName: node.name.replace(/-analysis$/, ""), part: "analysis" };
  }
  if (node.name.endsWith("-overview")) {
    return { baseName: node.name.replace(/-overview$/, ""), part: "analysis" };
  }
  return { baseName: node.name, part: "markdown" };
}

function getCollectionChildName(node: FileNode, part: CollectionPart): string {
  if (part === "pdf") return "PDF";
  if (part === "markdown") return "Markdown";
  if (node.name.endsWith("-overview")) return "Overview";
  return "Analysis";
}

function groupPaperCollections(nodes: FileNode[]): FileNode[] {
  const groups = new Map<string, Partial<Record<CollectionPart, FileNode[]>>>();

  for (const node of nodes) {
    const collectionPart = getCollectionPart(node);
    if (!collectionPart) continue;

    const group = groups.get(collectionPart.baseName) ?? {};
    const partNodes = group[collectionPart.part] ?? [];
    partNodes.push(node);
    group[collectionPart.part] = partNodes;
    groups.set(collectionPart.baseName, group);
  }

  const groupedNodes = new Set<FileNode>();
  const collectionNodes: FileNode[] = [];

  for (const [baseName, group] of groups) {
    if (!group.markdown?.length || !group.analysis?.length || !group.pdf?.length) {
      continue;
    }

    const children = [
      ...group.pdf.map((node) => ({ node, part: "pdf" as const })),
      ...group.analysis.map((node) => ({ node, part: "analysis" as const })),
      ...group.markdown.map((node) => ({ node, part: "markdown" as const })),
    ].map(({ node, part }) => {
      groupedNodes.add(node);
      return {
        ...node,
        name: getCollectionChildName(node, part),
      };
    });
    const firstChild = children[0];
    const parentSlug = firstChild.slug.includes("/")
      ? firstChild.slug.split("/").slice(0, -1).join("/")
      : "";

    collectionNodes.push({
      name: baseName,
      slug: parentSlug
        ? `${parentSlug}/${baseName}__paper-set`
        : `${baseName}__paper-set`,
      type: "directory",
      badge: "PDF set",
      children,
    });
  }

  if (collectionNodes.length === 0) return nodes;
  return [...nodes.filter((node) => !groupedNodes.has(node)), ...collectionNodes];
}

function groupPaperCollectionsDeep(nodes: FileNode[]): FileNode[] {
  const withGroupedChildren = nodes.map((node) => {
    if (!node.children) return node;
    return {
      ...node,
      children: groupPaperCollectionsDeep(node.children),
    };
  });

  return groupPaperCollections(withGroupedChildren);
}

function sortTree(nodes: FileNode[]) {
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}
