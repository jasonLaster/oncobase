export interface FileNode {
  name: string;
  slug: string;
  type: "file" | "directory" | "pdf";
  badge?: string;
  truncated?: boolean;
  pdfPath?: string;
  children?: FileNode[];
}

export type CompactFileNode =
  | ["d", string, CompactFileNode[], (string | null)?, string?]
  | ["f", string, string?]
  | ["p", string, string?];

export type WikiScope = "public" | "session";

export const WIKI_READER_CACHE_VERSION = "reader-v3";

export interface WikiManifestPage {
  slug: string;
  title: string;
  tags: string[];
  description: string | null;
  contentHash: string | null;
  sensitive: boolean;
  size: number;
}

export interface WikiManifestAsset {
  kind: "pdf" | "file";
  path: string;
  contentHash: string | null;
  size: number | null;
}

export interface WikiManifest {
  siteSlug: string;
  manifestHash: string;
  generatedAt: string;
  scope: WikiScope;
  compactTree: CompactFileNode[];
  pages: WikiManifestPage[];
  assets: WikiManifestAsset[];
}

export interface WikiSessionIdentity {
  siteSlug: string;
  scope: WikiScope;
  authenticated: boolean;
  cacheKey: string;
  cacheVersion: string;
  userHash: string | null;
}

export interface WikiPageRecord {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  contentHash: string | null;
  sensitive: boolean;
  size: number;
}

export interface WikiUnavailablePage {
  slug: string;
  title: string;
  tags: string[];
  description: string | null;
  contentHash: string | null;
  sensitive: true;
  size: number;
  reason: "sensitive-unavailable";
}

export interface WikiPageBatch {
  siteSlug: string;
  generatedAt: string;
  scope: WikiScope;
  pages: WikiPageRecord[];
  unavailable?: WikiUnavailablePage[];
  isDone: boolean;
  continueCursor: string | null;
}

export type ContentReconciliation =
  | { status: "missing" }
  | { status: "fresh"; contentHash: string | null }
  | { status: "stale"; localHash: string | null; remoteHash: string | null };

export type WikiContentClientOptions = {
  baseUrl?: string;
  credentials?: RequestCredentials;
  scope?: WikiScope;
  fetch?: typeof fetch;
  cache?: RequestCache;
  requestTimeoutMs?: number;
};

export type FetchPagesOptions = {
  cursor?: string | null;
  limit?: number;
  slugs?: string[];
};

function childSlug(parentSlug: string, name: string) {
  return parentSlug ? `${parentSlug}/${name}` : name;
}

function defaultPdfPath(parentSlug: string, name: string) {
  return `${childSlug(parentSlug, name)}.pdf`;
}

function splitSlug(slug: string) {
  return slug.split("/").filter(Boolean);
}

const HIDDEN_FILE_TREE_ROOT_DIRECTORIES = new Set(["diagnostics"]);
const HIDDEN_FILE_TREE_DIRECTORIES = new Set(["images"]);
const HIDDEN_FILE_TREE_FILENAMES = new Set(["package.json"]);
const HIDDEN_FILE_TREE_FILE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

export function isHiddenFileTreePath(path: string): boolean {
  const segments = splitSlug(path);
  if (HIDDEN_FILE_TREE_ROOT_DIRECTORIES.has((segments[0] ?? "").toLowerCase())) {
    return true;
  }

  return segments.some((segment) => {
    const lower = segment.toLowerCase();
    return (
      HIDDEN_FILE_TREE_DIRECTORIES.has(lower) ||
      HIDDEN_FILE_TREE_FILENAMES.has(lower) ||
      lower === "tsconfig" ||
      lower.startsWith("tsconfig.")
    );
  });
}

export function isHiddenFileTreeAssetPath(path: string): boolean {
  if (isHiddenFileTreePath(path)) return true;
  const lower = path.toLowerCase();
  return Array.from(HIDDEN_FILE_TREE_FILE_EXTENSIONS).some((extension) =>
    lower.endsWith(extension),
  );
}

function relativeSlug(fromSlug: string, toSlug: string) {
  const from = splitSlug(fromSlug);
  const to = splitSlug(toSlug);
  let common = 0;

  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }

  const up = Array.from({ length: from.length - common }, () => "..");
  const down = to.slice(common);
  return [...up, ...down].join("/") || ".";
}

function resolveRelativeSlug(fromSlug: string, override: string) {
  const segments = splitSlug(fromSlug);
  for (const part of override.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.join("/");
}

function compactPathOverride(
  parentSlug: string,
  name: string,
  slug: string,
  expectedSlug = childSlug(parentSlug, name),
) {
  if (slug === expectedSlug) return undefined;

  const relative = relativeSlug(parentSlug, slug);
  const safeRelative =
    relative.includes("/") && !relative.startsWith("../") ? `./${relative}` : relative;

  return safeRelative.length < slug.length ? safeRelative : slug;
}

function expandPathOverride(
  parentSlug: string,
  name: string,
  override?: string,
  defaultSlug = childSlug(parentSlug, name),
) {
  if (!override) return defaultSlug;
  if (
    override === "." ||
    override === ".." ||
    override.startsWith("../") ||
    override.startsWith("./")
  ) {
    return resolveRelativeSlug(parentSlug, override);
  }
  return override.includes("/") ? override : childSlug(parentSlug, override);
}

export function compactFileTree(nodes: FileNode[], parentSlug = ""): CompactFileNode[] {
  return nodes.map((node) => {
    if (node.type === "directory") {
      const compactChildren = compactFileTree(node.children ?? [], node.slug);
      const badge = node.badge ?? null;
      const slugOverride = compactPathOverride(parentSlug, node.name, node.slug);

      if (slugOverride) return ["d", node.name, compactChildren, badge, slugOverride];
      if (badge) return ["d", node.name, compactChildren, badge];
      return ["d", node.name, compactChildren];
    }

    if (node.type === "pdf") {
      const pdfPath = node.pdfPath ?? node.slug;
      const expectedPdfPath = defaultPdfPath(parentSlug, node.name);
      const pdfPathOverride = compactPathOverride(
        parentSlug,
        node.name,
        pdfPath,
        expectedPdfPath,
      );
      return pdfPath === expectedPdfPath
        ? ["p", node.name]
        : ["p", node.name, pdfPathOverride];
    }

    const expectedSlug = childSlug(parentSlug, node.name);
    const slugOverride = compactPathOverride(parentSlug, node.name, node.slug);
    return node.slug === expectedSlug ? ["f", node.name] : ["f", node.name, slugOverride];
  });
}

export function expandCompactFileTree(nodes: CompactFileNode[], parentSlug = ""): FileNode[] {
  return nodes.map((node) => {
    const [type, name] = node;

    if (type === "d") {
      const children = node[2];
      const badge = node[3] ?? undefined;
      const slug = expandPathOverride(parentSlug, name, node[4]);
      return {
        name,
        slug,
        type: "directory",
        ...(badge ? { badge } : {}),
        children: expandCompactFileTree(children, slug),
      };
    }

    if (type === "p") {
      const pdfPath = expandPathOverride(
        parentSlug,
        name,
        node[2],
        defaultPdfPath(parentSlug, name),
      );
      return { name, slug: pdfPath, type: "pdf", pdfPath };
    }

    const slug = expandPathOverride(parentSlug, name, node[2]);
    return { name, slug, type: "file" };
  });
}

export function flattenFileTree(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  const visit = (node: FileNode) => {
    out.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

export function buildFileTreeFromManifest(
  pages: Array<Pick<WikiManifestPage, "slug">>,
  assets: Array<Pick<WikiManifestAsset, "kind" | "path">> = [],
): FileNode[] {
  const root: FileNode[] = [];

  for (const page of pages) {
    if (isHiddenFileTreePath(page.slug)) continue;
    insertFileNode(root, splitSlug(page.slug), "file");
  }
  for (const asset of assets) {
    if (isHiddenFileTreeAssetPath(asset.path)) continue;
    const segments = splitSlug(asset.path);
    if (segments.length === 0) continue;

    if (asset.kind === "pdf" || asset.path.toLowerCase().endsWith(".pdf")) {
      const name = segments[segments.length - 1]!.replace(/\.pdf$/i, "");
      insertFileNode(
        root,
        [...segments.slice(0, -1), name],
        "pdf",
        asset.path,
      );
    } else {
      insertFileNode(root, segments, "file");
    }
  }

  sortFileTree(root);
  return root;
}

export function buildCompactTreeFromManifest(
  pages: Array<Pick<WikiManifestPage, "slug">>,
  assets: Array<Pick<WikiManifestAsset, "kind" | "path">> = [],
): CompactFileNode[] {
  return compactFileTree(buildFileTreeFromManifest(pages, assets));
}

function weekNumberFromName(name: string) {
  return /^week-(\d+)(?:\b|-)/i.exec(name)?.[1];
}

export function compareFileTreeNodes(
  a: Pick<FileNode, "name" | "type">,
  b: Pick<FileNode, "name" | "type">,
) {
  if (a.type === "directory" && b.type !== "directory") return -1;
  if (a.type !== "directory" && b.type === "directory") return 1;

  const aWeek = weekNumberFromName(a.name);
  const bWeek = weekNumberFromName(b.name);
  if (aWeek && bWeek) return Number(bWeek) - Number(aWeek);
  if (aWeek) return -1;
  if (bWeek) return 1;

  return a.name.localeCompare(b.name);
}

function insertFileNode(
  nodes: FileNode[],
  segments: string[],
  type: "file" | "pdf",
  pdfPath?: string,
  parentSlug = "",
) {
  if (segments.length === 0) return;
  const [name, ...rest] = segments;
  const slug = parentSlug ? `${parentSlug}/${name}` : name;

  if (rest.length === 0) {
    const existing = nodes.find((node) => node.name === name);
    const nextNode: FileNode =
      type === "pdf"
        ? { name, slug: pdfPath ?? slug, type: "pdf", pdfPath: pdfPath ?? slug }
        : { name, slug, type: "file" };

    if (!existing) {
      nodes.push(nextNode);
      return;
    }

    if (existing.type === "directory") {
      existing.children = existing.children ?? [];
      existing.children.unshift(nextNode);
      return;
    }

    Object.assign(existing, nextNode);
    return;
  }

  let directory = nodes.find(
    (node) => node.name === name && node.type === "directory",
  );
  if (!directory) {
    directory = { name, slug, type: "directory", children: [] };
    nodes.push(directory);
  }
  directory.children = directory.children ?? [];
  insertFileNode(directory.children, rest, type, pdfPath, slug);
}

function sortFileTree(nodes: FileNode[]) {
  nodes.sort(compareFileTreeNodes);
  for (const node of nodes) sortFileTree(node.children ?? []);
}

export function reconcilePageContent(
  local: { contentHash?: string | null } | null | undefined,
  remote: { contentHash?: string | null } | null | undefined,
): ContentReconciliation {
  if (!local) return { status: "missing" };
  const localHash = local.contentHash ?? null;
  const remoteHash = remote?.contentHash ?? null;
  return localHash === remoteHash
    ? { status: "fresh", contentHash: remoteHash }
    : { status: "stale", localHash, remoteHash };
}

export function makeWikiStoreId({
  siteSlug,
  scope,
  origin,
  cacheKey = "anonymous",
  readerCacheVersion = WIKI_READER_CACHE_VERSION,
}: {
  siteSlug: string;
  scope: WikiScope;
  origin: string;
  cacheKey?: string;
  readerCacheVersion?: string;
}) {
  const safeReaderCacheVersion = readerCacheVersion.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeSiteSlug = siteSlug.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeOrigin = origin.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeCacheKey = cacheKey.replace(/[^A-Za-z0-9_-]/g, "_");
  return `wiki-vite-${safeReaderCacheVersion}-${safeSiteSlug}-${scope}-${safeOrigin}-${safeCacheKey}`;
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function asNullableString(value: unknown, label: string): string | null {
  if (value == null) return null;
  return asString(value, label);
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function asScope(value: unknown): WikiScope {
  if (value === "public" || value === "session") return value;
  throw new Error("scope must be public or session");
}

function parseManifestPage(value: unknown): WikiManifestPage {
  const object = assertObject(value, "manifest page");
  return {
    slug: asString(object.slug, "page.slug"),
    title: asString(object.title, "page.title"),
    tags: asStringArray(object.tags, "page.tags"),
    description: asNullableString(object.description, "page.description"),
    contentHash: asNullableString(object.contentHash, "page.contentHash"),
    sensitive: asBoolean(object.sensitive, "page.sensitive"),
    size: asNumber(object.size, "page.size"),
  };
}

function parseManifestAsset(value: unknown): WikiManifestAsset {
  const object = assertObject(value, "manifest asset");
  const kind = object.kind;
  if (kind !== "pdf" && kind !== "file") {
    throw new Error("asset.kind must be pdf or file");
  }
  return {
    kind,
    path: asString(object.path, "asset.path"),
    contentHash: asNullableString(object.contentHash, "asset.contentHash"),
    size: object.size == null ? null : asNumber(object.size, "asset.size"),
  };
}

function isCompactFileNode(value: unknown): value is CompactFileNode {
  if (!Array.isArray(value)) return false;
  const type = value[0];
  if (type === "d") {
    return (
      typeof value[1] === "string" &&
      Array.isArray(value[2]) &&
      value[2].every(isCompactFileNode)
    );
  }
  return (
    (type === "f" || type === "p") &&
    typeof value[1] === "string" &&
    (value[2] == null || typeof value[2] === "string")
  );
}

export function parseWikiManifest(value: unknown): WikiManifest {
  const object = assertObject(value, "manifest");
  const compactTree = object.compactTree;
  if (!Array.isArray(compactTree) || !compactTree.every(isCompactFileNode)) {
    throw new Error("manifest.compactTree must be a compact file tree");
  }
  const pages = object.pages;
  const assets = object.assets;
  if (!Array.isArray(pages)) throw new Error("manifest.pages must be an array");
  if (!Array.isArray(assets)) throw new Error("manifest.assets must be an array");

  return {
    siteSlug: asString(object.siteSlug, "manifest.siteSlug"),
    manifestHash: asString(object.manifestHash, "manifest.manifestHash"),
    generatedAt: asString(object.generatedAt, "manifest.generatedAt"),
    scope: asScope(object.scope),
    compactTree,
    pages: pages.map(parseManifestPage),
    assets: assets.map(parseManifestAsset),
  };
}

export function parseWikiSessionIdentity(value: unknown): WikiSessionIdentity {
  const object = assertObject(value, "session identity");
  return {
    siteSlug: asString(object.siteSlug, "session.siteSlug"),
    scope: asScope(object.scope),
    authenticated: asBoolean(object.authenticated, "session.authenticated"),
    cacheKey: asString(object.cacheKey, "session.cacheKey"),
    cacheVersion: asString(object.cacheVersion, "session.cacheVersion"),
    userHash: asNullableString(object.userHash, "session.userHash"),
  };
}

function parsePageRecord(value: unknown): WikiPageRecord {
  const object = assertObject(value, "page record");
  return {
    slug: asString(object.slug, "page.slug"),
    title: asString(object.title, "page.title"),
    content: asString(object.content, "page.content"),
    tags: asStringArray(object.tags, "page.tags"),
    contentHash: asNullableString(object.contentHash, "page.contentHash"),
    sensitive: asBoolean(object.sensitive, "page.sensitive"),
    size: asNumber(object.size, "page.size"),
  };
}

function parseUnavailablePage(value: unknown): WikiUnavailablePage {
  const object = assertObject(value, "unavailable page");
  const reason = object.reason;
  if (reason !== "sensitive-unavailable") {
    throw new Error("unavailable.reason must be sensitive-unavailable");
  }
  return {
    slug: asString(object.slug, "unavailable.slug"),
    title: asString(object.title, "unavailable.title"),
    tags: asStringArray(object.tags, "unavailable.tags"),
    description: asNullableString(object.description, "unavailable.description"),
    contentHash: asNullableString(object.contentHash, "unavailable.contentHash"),
    sensitive: true,
    size: asNumber(object.size, "unavailable.size"),
    reason,
  };
}

export function parseWikiPageBatch(value: unknown): WikiPageBatch {
  const object = assertObject(value, "page batch");
  const pages = object.pages;
  const unavailable = object.unavailable;
  if (!Array.isArray(pages)) throw new Error("page batch pages must be an array");
  if (unavailable != null && !Array.isArray(unavailable)) {
    throw new Error("page batch unavailable must be an array");
  }
  return {
    siteSlug: asString(object.siteSlug, "pageBatch.siteSlug"),
    generatedAt: asString(object.generatedAt, "pageBatch.generatedAt"),
    scope: asScope(object.scope),
    pages: pages.map(parsePageRecord),
    ...(unavailable ? { unavailable: unavailable.map(parseUnavailablePage) } : {}),
    isDone: asBoolean(object.isDone, "pageBatch.isDone"),
    continueCursor: asNullableString(object.continueCursor, "pageBatch.continueCursor"),
  };
}

function urlWithParams(baseUrl: string, pathname: string, params: Record<string, string>) {
  const url =
    baseUrl.length > 0
      ? new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
      : new URL(pathname, "http://local.invalid");
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return baseUrl.length > 0 ? url.toString() : `${url.pathname}${url.search}`;
}

async function fetchJson(
  fetchFn: typeof fetch,
  url: string,
  credentials: RequestCredentials,
  cache: RequestCache,
  requestTimeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchFn(url, {
      cache,
      credentials,
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Wiki request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<unknown>;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Wiki request timed out after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function createWikiContentClient({
  baseUrl = "",
  credentials = "same-origin",
  scope = "public",
  fetch: fetchFn = globalThis.fetch,
  cache = "no-cache",
  requestTimeoutMs = 15_000,
}: WikiContentClientOptions = {}) {
  return {
    async fetchManifest() {
      const url = urlWithParams(baseUrl, "/api/wiki/manifest", { scope });
      return parseWikiManifest(await fetchJson(fetchFn, url, credentials, cache, requestTimeoutMs));
    },
    async fetchSessionIdentity() {
      const url = urlWithParams(baseUrl, "/api/wiki/session", { scope });
      return parseWikiSessionIdentity(
        await fetchJson(fetchFn, url, credentials, cache, requestTimeoutMs),
      );
    },
    async fetchPages({ cursor, limit, slugs }: FetchPagesOptions = {}) {
      const params: Record<string, string> = { scope };
      if (cursor) params.cursor = cursor;
      if (limit) params.limit = String(limit);
      if (slugs?.length) params.slugs = slugs.join(",");
      const url = urlWithParams(baseUrl, "/api/wiki/pages", params);
      return parseWikiPageBatch(await fetchJson(fetchFn, url, credentials, cache, requestTimeoutMs));
    },
  };
}
