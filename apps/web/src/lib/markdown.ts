import { headers } from "next/headers";
import { cacheLife, cacheTag } from "next/cache";
import { siteDataFromSlug } from "@/lib/site-data";
import { DEFAULT_SITE_SLUG, toSiteSlug, type SiteSlug } from "@/lib/site";
import { shouldSkipConvexReads } from "@/lib/convex-url";
import {
  compactFileTree,
  expandCompactFileTree,
  type CompactFileNode,
  type FileNode,
} from "@/lib/file-tree-compact";
import {
  pruneFileTreeForShell,
  type ShellFileTreeOptions,
} from "@/lib/file-tree-shell";
import { isHiddenFileTreeAssetPath, isHiddenFileTreePath } from "@/lib/file-tree-paths";
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
// `apps/web/scripts/publish/` is the only producer of this data; the
// runtime never touches the filesystem. See:
// - plans/multi-tenant-wiki/01-content-source.md
// - apps/web/specs/multi-site.md

export type { CompactFileNode, FileNode };
export { isHiddenFileTreeAssetPath, isHiddenFileTreePath };

export interface MarkdownFile {
  slug: string;
  title: string;
  content: string;
  contentHash?: string;
  sensitive?: boolean;
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
  includeSensitive?: boolean;
}

interface MarkdownDiscoveryOptions {
  includeSensitive?: boolean;
}

const PROJECT_MANAGEMENT_VIEW_FILES = new Set([
  "1-inbox",
  "2-urgent",
  "3-completed",
  "4-backlog",
]);

export function canonicalizePublishedSlug(slug: string): string {
  const prefix = "project-management/";
  if (!slug.startsWith(prefix)) return slug;
  const rest = slug.slice(prefix.length);
  if (!PROJECT_MANAGEMENT_VIEW_FILES.has(rest)) return slug;
  return `${prefix}views/${rest}`;
}

function legacyPublishedSlug(slug: string): string | null {
  const prefix = "project-management/views/";
  if (!slug.startsWith(prefix)) return null;
  const rest = slug.slice(prefix.length);
  if (!PROJECT_MANAGEMENT_VIEW_FILES.has(rest)) return null;
  return `project-management/${rest}`;
}

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
): Promise<Array<[string, string]>> {
  "use cache";
  cacheLife("hours");
  cacheTag(siteCacheTag(siteSlug), siteDocsCacheTag(siteSlug));

  const docs = await fetchAllDocsForSite(siteSlug, includeSensitive);
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const canonicalSlug = canonicalizePublishedSlug(doc.slug);
    const lower = canonicalSlug.toLowerCase();
    if (!seen.has(lower)) {
      entries.push([lower, canonicalSlug]);
      seen.add(lower);
    }
  }
  return entries;
}

async function fetchCanonicalSlugMapForSite(
  siteSlug: SiteSlug,
  includeSensitive = false,
): Promise<Map<string, string>> {
  return new Map(await fetchCanonicalSlugEntriesForSite(siteSlug, includeSensitive));
}

async function fetchCanonicalSlugMap({
  includeSensitive = false,
}: MarkdownDiscoveryOptions = {}): Promise<Map<string, string>> {
  return fetchCanonicalSlugMapForSite(await readSiteSlug(), includeSensitive);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getMarkdownFileForSite(
  siteSlug: SiteSlug,
  slug: string,
  { includeSensitive = false }: MarkdownReadOptions = {},
): Promise<MarkdownFile | null> {
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
  { includeSensitive = false }: MarkdownReadOptions = {},
): Promise<MarkdownFile | null> {
  if (shouldSkipConvexReads()) return null;
  const siteData = siteDataFromSlug(siteSlug);
  let doc = await siteData.documents.getBySlug(
    includeSensitive ? { slug, includeSensitive: true } : { slug },
  );
  if (!doc) {
    const indexSlug = `${slug}/index`;
    doc = await siteData.documents.getBySlug(
      includeSensitive
        ? { slug: indexSlug, includeSensitive: true }
        : { slug: indexSlug },
    );
  }
  const legacySlug = legacyPublishedSlug(slug);
  if (!doc && legacySlug) {
    doc = await siteData.documents.getBySlug(
      includeSensitive
        ? { slug: legacySlug, includeSensitive: true }
        : { slug: legacySlug },
    );
  }
  if (!doc) return null;
  const resolvedSlug = legacySlug && doc.slug === legacySlug ? slug : doc.slug;

  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const frontmatter: Record<string, unknown> = { tags };
  if (doc.description) frontmatter.description = doc.description;
  if (doc.sensitive) frontmatter.sensitive = true;

  return {
    slug: canonicalizePublishedSlug(resolvedSlug),
    title: doc.title,
    content: doc.content,
    contentHash: doc.contentHash,
    sensitive: doc.sensitive,
    frontmatter,
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

  const root: FileNode[] = [];

  for (const doc of docs) {
    if (isHiddenFileTreePath(doc.slug)) continue;
    insertSlug(root, canonicalizePublishedSlug(doc.slug), "file");
  }
  for (const pdfPath of pdfPaths) {
    if (isHiddenFileTreePath(pdfPath)) continue;
    insertPdf(root, pdfPath);
  }
  for (const filePath of filePaths) {
    if (isHiddenFileTreeAssetPath(filePath)) continue;
    insertSlug(root, filePath, "file");
  }

  const grouped = groupFileTreeCollectionsDeep(root);
  sortTree(grouped);
  return compactFileTree(grouped);
}

/** Build the sidebar file tree from Convex documents + assets. */
export async function getFileTreeForSite(
  siteSlug: SiteSlug,
  options: MarkdownDiscoveryOptions = {},
): Promise<FileNode[]> {
  return expandCompactFileTree(await getCompactFileTreeForSite(siteSlug, options));
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

// ── Meeting-note grouping ────────────────────────────────────────────────────

type MeetingNotePart = "overview" | "formatted" | "raw";

function getMeetingNotePart(
  node: FileNode,
): { baseName: string; part: MeetingNotePart } | null {
  if (node.type !== "file") return null;

  if (node.name.endsWith("-transcript-formatted")) {
    return {
      baseName: node.name.replace(/-transcript-formatted$/, ""),
      part: "formatted",
    };
  }
  if (node.name.endsWith("-overview")) {
    return { baseName: node.name.replace(/-overview$/, ""), part: "overview" };
  }
  if (node.name.endsWith("-formatted")) {
    return { baseName: node.name.replace(/-formatted$/, ""), part: "formatted" };
  }
  if (node.name.endsWith("-raw")) {
    return { baseName: node.name.replace(/-raw$/, ""), part: "raw" };
  }

  return null;
}

function getMeetingNoteChildName(part: MeetingNotePart): string {
  if (part === "overview") return "Overview";
  if (part === "formatted") return "Formatted";
  return "Raw";
}

function groupMeetingNoteSets(nodes: FileNode[]): FileNode[] {
  const groups = new Map<string, Partial<Record<MeetingNotePart, FileNode[]>>>();

  for (const node of nodes) {
    const meetingNotePart = getMeetingNotePart(node);
    if (!meetingNotePart) continue;

    const group = groups.get(meetingNotePart.baseName) ?? {};
    const partNodes = group[meetingNotePart.part] ?? [];
    partNodes.push(node);
    group[meetingNotePart.part] = partNodes;
    groups.set(meetingNotePart.baseName, group);
  }

  const groupedNodes = new Set<FileNode>();
  const collectionNodes: FileNode[] = [];

  for (const [baseName, group] of groups) {
    if (!group.overview?.length || !group.formatted?.length || !group.raw?.length) {
      continue;
    }

    const children = [
      ...group.overview.map((node) => ({ node, part: "overview" as const })),
      ...group.formatted.map((node) => ({ node, part: "formatted" as const })),
      ...group.raw.map((node) => ({ node, part: "raw" as const })),
    ].map(({ node, part }) => {
      groupedNodes.add(node);
      return {
        ...node,
        name: getMeetingNoteChildName(part),
      };
    });
    const firstChild = children[0];
    const parentSlug = firstChild.slug.includes("/")
      ? firstChild.slug.split("/").slice(0, -1).join("/")
      : "";

    collectionNodes.push({
      name: baseName,
      slug: parentSlug
        ? `${parentSlug}/${baseName}__meeting-set`
        : `${baseName}__meeting-set`,
      type: "directory",
      badge: "Notes set",
      children,
    });
  }

  if (collectionNodes.length === 0) return nodes;
  return [...nodes.filter((node) => !groupedNodes.has(node)), ...collectionNodes];
}

function groupMeetingNoteSetsDeep(nodes: FileNode[]): FileNode[] {
  const withGroupedChildren = nodes.map((node) => {
    if (!node.children) return node;
    return {
      ...node,
      children: groupMeetingNoteSetsDeep(node.children),
    };
  });

  return groupMeetingNoteSets(withGroupedChildren);
}

export function groupFileTreeCollectionsDeep(nodes: FileNode[]): FileNode[] {
  return groupPaperCollectionsDeep(groupMeetingNoteSetsDeep(nodes));
}

function isArchivedDirectory(node: FileNode) {
  return node.type === "directory" && node.name === "archived";
}

export function sortTree(nodes: FileNode[]) {
  nodes.sort((a, b) => {
    if (a.name === "index" && b.name !== "index") return -1;
    if (b.name === "index" && a.name !== "index") return 1;
    if (isArchivedDirectory(a) && !isArchivedDirectory(b)) return 1;
    if (isArchivedDirectory(b) && !isArchivedDirectory(a)) return -1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}
