import { buildCompactTreeFromManifest } from "./manifest-tree.ts";
import type { ManifestSnapshotCache } from "./manifest-snapshot-cache.ts";
export {
  createManifestSnapshotCache,
  type ManifestSnapshotCache,
  type ManifestSnapshotCacheKind,
  type ManifestSnapshotCacheOptions,
} from "./manifest-snapshot-cache.ts";
import crypto from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import type {
  WikiManifest,
  WikiManifestAsset,
  WikiManifestPage,
  WikiPageBatch,
  WikiPageRecord,
  WikiScope,
  WikiSessionIdentity,
  WikiUnavailablePage,
} from "./index.ts";
import {
  compactWikiManifest,
  makePublicWikiSessionIdentity,
  parseWikiManifest,
  WIKI_MANIFEST_SCHEMA_VERSION,
  WIKI_SESSION_CACHE_VERSION,
} from "./index.ts";

const PUBLIC_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
const PUBLIC_CDN_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";
const PRIVATE_CACHE_CONTROL = "private, max-age=30, stale-while-revalidate=300";
const MANIFEST_PAGE_SIZE = 500;
const MANIFEST_FALLBACK_PAGE_SIZE = 25;
const ASSET_PAGE_SIZE = 1000;
const MANIFEST_TIMEOUT_MS = 20_000;
const MANIFEST_BOUNDED_FALLBACK_TIMEOUT_MS = 5_000;
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;
const gzipAsync = promisify(gzip);

function representationHeaders(init: HeadersInit) {
  const headers = new Headers(init);
  if (!headers.get("Vary")?.toLowerCase().split(/,\s*/).includes("accept-encoding")) headers.append("Vary", "Accept-Encoding");
  return headers;
}

function acceptsGzip(request: Request) {
  return (request.headers.get("accept-encoding") ?? "").split(",").some(part => {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    const q = parameters.find(p => p.trim().startsWith("q="))?.trim().slice(2);
    return name === "gzip" && (q === undefined || (Number.isFinite(Number(q)) && Number(q) > 0));
  });
}

type EncodedContent = { body: Uint8Array<ArrayBuffer> | string; gzip: boolean };

async function encodeContent(json: string, gzipAccepted: boolean): Promise<EncodedContent> {
  if (json.length >= 1024 && gzipAccepted) return { body: new Uint8Array(await gzipAsync(json)), gzip: true };
  return { body: json, gzip: false };
}

function encodedResponse({ body, gzip }: EncodedContent, init: HeadersInit) {
  const headers = representationHeaders(init);
  headers.set("Content-Type", "application/json");
  if (gzip) headers.set("Content-Encoding", "gzip");
  return new Response(body, { headers });
}

async function contentResponse(request: Request, json: string, init: HeadersInit) {
  return encodedResponse(await encodeContent(json, acceptsGzip(request)), init);
}

/** RFC 9110 If-None-Match uses weak comparison: `W/"x"` and `"x"` both match. */
function ifNoneMatchMatches(request: Request, etag: string) {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const tag = candidate.trim();
    return tag === "*" || tag.replace(/^W\//, "") === `"${etag}"`;
  });
}

function manifestJson(request: Request, manifest: WikiManifest) {
  return JSON.stringify(new URL(request.url).searchParams.get("format") === "compact-v1"
    ? compactWikiManifest(manifest) : manifest);
}

export type WikiApiSessionUser = {
  _id: string;
};

export type WikiApiSlugAccess = {
  slug: string;
  allowed: boolean;
  hasDocument: boolean;
};

export type WikiApiAccessAdapter = {
  canUserAccessSlug(user: WikiApiSessionUser, slug: string): Promise<boolean>;
  filterAccessibleSlugs(
    user: WikiApiSessionUser,
    slugs: string[],
  ): Promise<WikiApiSlugAccess[]>;
  getAllowedSlugs(user: WikiApiSessionUser): Promise<string[]>;
  listAllowedManifestPage?(user: WikiApiSessionUser, args: { cursor: string | null; numItems: number }): Promise<ManifestPageResult>;
};

export type ManifestPageResult = {
  page: WikiManifestPage[];
  isDone: boolean;
  continueCursor: string | null;
};

export type PageWithContent = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  description?: string | null;
  contentHash?: string | null;
  sensitive?: boolean;
};

export type PageWithContentResult = {
  page: PageWithContent[];
  isDone: boolean;
  continueCursor: string | null;
};

export type AssetPathResult = {
  page: string[];
  isDone: boolean;
  continueCursor: string | null;
};

export type AssetVisibilityRecord = {
  path: string;
  ownerSlugs: string[];
  sensitive: boolean;
};

export type AssetVisibilityResult = {
  page: AssetVisibilityRecord[];
  isDone: boolean;
  continueCursor: string | null;
};

export type WikiApiDocumentsGateway = {
  listManifestPage(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<ManifestPageResult>;
  listPageWithContent(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<PageWithContentResult>;
  listPdfAssetPathsPage(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<AssetPathResult>;
  listFileAssetPathsPage(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<AssetPathResult>;
  listPdfAssetVisibilityPage(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<AssetVisibilityResult>;
  listFileAssetVisibilityPage(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<AssetVisibilityResult>;
  getBySlug(args: {
    slug: string;
    includeSensitive?: boolean;
  }): Promise<PageWithContent | null>;
};

export type WikiApiContext = {
  siteSlug: string;
  publicIdentity?: WikiSessionIdentity;
  documents: WikiApiDocumentsGateway;
  getSessionUser(request: Request): Promise<WikiApiSessionUser | null>;
  access?: WikiApiAccessAdapter;
  manifestPrioritySlugs?: string[];
  // Only public-scope snapshots; session responses still compute access live.
  getManifestSnapshot?: () => Promise<{ hash: string; revision?: number; read: () => Promise<BodyInit> } | null>;
  // Per-instance memo keyed by snapshot hash: skips the storage read and the
  // decode/compact/gzip work for repeat requests of the same snapshot.
  manifestSnapshotCache?: ManifestSnapshotCache;
  decorateHeaders?: (headers: HeadersInit) => HeadersInit;
  logger?: Pick<Console, "error" | "warn">;
  onManifestFallback?: (reason: "snapshot-unavailable" | "snapshot-invalid" | "private-query" | "snapshot-changed") => void;
  onManifestPhase?: (phase: "read" | "overlay" | "assets" | "filter" | "tree" | "hash" | "serialize" | "snapshot-encode" | "snapshot-derive", durationMs: number) => void;
  // A fixed, public subset of the public manifest (e.g. the education curriculum
  // for logged-out readers). It is derived from the verified public snapshot by
  // filtering, then rebuilt and hashed exactly like the live path. Only for
  // callers whose live gateway applies the same filters; the equivalence is
  // pinned by apps/app/server/education-manifest.test.ts.
  publicSubset?: WikiPublicSubset;
};

export type WikiPublicSubset = {
  name: string;
  includePage(page: { slug: string; sensitive?: boolean }): boolean;
  includeAsset(asset: { kind: string; path: string }): boolean;
};

function requestedScope(request: Request): WikiScope {
  const scope = new URL(request.url).searchParams.get("scope");
  return scope === "session" ? "session" : "public";
}

function hashJson(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

function fullHashJson(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function userHash(siteSlug: string, userId: string) {
  return crypto
    .createHash("sha256")
    .update(`${siteSlug}:${userId}:${WIKI_SESSION_CACHE_VERSION}`)
    .digest("hex")
    .slice(0, 24);
}

function cacheHeaders(scope: WikiScope, etag: string) {
  return {
    "Cache-Control": scope === "public" ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
    ...(scope === "public" ? { "CDN-Cache-Control": PUBLIC_CDN_CACHE_CONTROL } : {}),
    Vary: scope === "public" ? "Accept, Accept-Encoding, x-site-slug" : "Accept, Accept-Encoding, Cookie, x-site-slug",
    ETag: `W/"${etag}"`,
    "X-Wiki-Cache-Scope": scope,
  };
}

function provisionalManifestHeaders(scope: WikiScope, etag: string) {
  return {
    "Cache-Control": scope === "session" ? "private, no-store" : "no-store",
    Vary: scope === "public" ? "Accept, Accept-Encoding, x-site-slug" : "Accept, Accept-Encoding, Cookie, x-site-slug",
    ETag: `W/"${etag}"`,
    "X-Wiki-Cache-Scope": scope,
    "X-Wiki-Manifest-Partial": "true",
  };
}

function decorate(context: WikiApiContext, headers: HeadersInit) {
  return context.decorateHeaders ? context.decorateHeaders(headers) : headers;
}

function pageRecord(page: PageWithContent): WikiPageRecord {
  return {
    slug: page.slug,
    title: page.title,
    content: page.content,
    tags: page.tags,
    contentHash: page.contentHash ?? null,
    sensitive: page.sensitive === true,
    size: page.content.length,
  };
}

function manifestPageFromContent(page: PageWithContent): WikiManifestPage {
  return {
    slug: page.slug,
    title: page.title,
    tags: page.tags,
    description: page.description ?? null,
    contentHash: page.contentHash ?? null,
    sensitive: page.sensitive === true,
    size: page.content.length,
  };
}

function unavailablePageFromContent(page: PageWithContent): WikiUnavailablePage {
  return {
    slug: page.slug,
    title: "Private page",
    tags: [],
    description: null,
    contentHash: null,
    sensitive: true,
    size: 0,
    reason: "sensitive-unavailable",
  };
}

type ManifestSource = "snapshot-overlay" | "manifest" | "content-fallback" | "bounded-content-fallback";

async function requireSessionIfNeeded(
  request: Request,
  context: WikiApiContext,
  scope: WikiScope,
) {
  if (scope === "public") return null;
  return await context.getSessionUser(request);
}

const ACCESS_CHECK_CHUNK_SIZE = 100;
const ACCESS_CHECK_CONCURRENCY = 4;
// `/api/wiki/pages?slugs=` accepts up to MAX_PAGE_LIMIT slugs; bound the
// per-slug document reads instead of issuing them all at once.
const PAGE_LOOKUP_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// A manifest checks some slugs both as asset owners and as documents. Share
// in-flight/results only within this response, never across users or requests.
function withManifestAccessCache(context: WikiApiContext): WikiApiContext {
  const adapter = context.access;
  if (!adapter) return context;
  const users = new Map<string, Map<string, Promise<WikiApiSlugAccess | undefined>>>();
  return {
    ...context,
    access: {
      ...adapter,
      async filterAccessibleSlugs(user, slugs) {
        let cache = users.get(user._id);
        if (!cache) { cache = new Map(); users.set(user._id, cache); }
        const missing = [...new Set(slugs)].filter((slug) => !cache.has(slug));
        if (missing.length > 0) {
          const pending = adapter.filterAccessibleSlugs(user, missing)
            .then((results) => new Map(results.map((result) => [result.slug, result])));
          for (const slug of missing) cache.set(slug, pending.then((results) => results.get(slug)));
        }
        const results = await Promise.all(slugs.map((slug) => cache!.get(slug)!));
        return results.filter((result): result is WikiApiSlugAccess => result !== undefined);
      },
    },
  };
}

async function accessBySlug(
  context: WikiApiContext,
  user: WikiApiSessionUser | null,
  slugs: string[],
): Promise<Map<string, WikiApiSlugAccess>> {
  const access = new Map<string, WikiApiSlugAccess>();
  if (slugs.length === 0) return access;
  if (!user || !context.access) {
    for (const slug of slugs) {
      access.set(slug, { slug, allowed: false, hasDocument: false });
    }
    return access;
  }
  const unique = [...new Set(slugs)];
  for (let i = 0; i < unique.length; i += ACCESS_CHECK_CHUNK_SIZE * ACCESS_CHECK_CONCURRENCY) {
    const chunks: string[][] = [];
    for (let j = i; j < Math.min(unique.length, i + ACCESS_CHECK_CHUNK_SIZE * ACCESS_CHECK_CONCURRENCY); j += ACCESS_CHECK_CHUNK_SIZE) {
      chunks.push(unique.slice(j, j + ACCESS_CHECK_CHUNK_SIZE));
    }
    const batches = await Promise.all(chunks.map((chunk) => context.access!.filterAccessibleSlugs(user, chunk)));
    for (const results of batches) {
      for (const result of results) access.set(result.slug, result);
    }
  }
  return access;
}

async function filterReadablePages<T extends Pick<PageWithContent | WikiManifestPage, "sensitive" | "slug">>(
  context: WikiApiContext,
  user: WikiApiSessionUser | null,
  pages: T[],
): Promise<T[]> {
  const sensitiveSlugs = pages
    .filter((page) => page.sensitive === true)
    .map((page) => page.slug);
  const access = await accessBySlug(context, user, sensitiveSlugs);
  return pages.filter(
    (page) => page.sensitive !== true || access.get(page.slug)?.allowed === true,
  );
}

type ManifestAssetCandidate = WikiManifestAsset & {
  ownerSlugs: string[];
  sensitive: boolean;
};

function publicManifestAsset(
  asset: ManifestAssetCandidate,
): WikiManifestAsset {
  return {
    kind: asset.kind,
    path: asset.path,
    contentHash: asset.contentHash,
    size: asset.size,
  };
}

async function filterAssetsForUser(
  context: WikiApiContext,
  user: WikiApiSessionUser | null,
  assets: ManifestAssetCandidate[],
) {
  const access = await accessBySlug(
    context,
    user,
    assets.filter((asset) => asset.sensitive).flatMap((asset) => asset.ownerSlugs),
  );
  return assets
    .filter((asset) => {
      if (!asset.sensitive) return true;
      if (asset.ownerSlugs.length === 0) return false;
      return asset.ownerSlugs.every((slug) => {
        const result = access.get(slug);
        return result?.hasDocument === true && result.allowed === true;
      });
    })
    .map(publicManifestAsset);
}

type ManifestPages = { pages: WikiManifestPage[]; source: ManifestSource; base?: { hash: string; overlay: WikiManifestPage[] } };

async function listManifestPages(
  context: WikiApiContext,
  includeSensitive: boolean,
): Promise<ManifestPages> {
  const pages: WikiManifestPage[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let source: ManifestSource = "manifest";
  let useContentFallback = false;
  while (!isDone) {
    const args: {
      cursor: string | null;
      numItems: number;
      includeSensitive?: boolean;
    } = {
      cursor,
      numItems: useContentFallback ? MANIFEST_FALLBACK_PAGE_SIZE : MANIFEST_PAGE_SIZE,
      ...(includeSensitive ? { includeSensitive: true } : {}),
    };
    const result: ManifestPageResult = useContentFallback
      ? await listManifestPageFromContent(context, args)
      : await context.documents.listManifestPage(args).catch(async (error) => {
          context.logger?.warn("[wiki manifest] Falling back to content metadata", error);
          if ((context.manifestPrioritySlugs?.length ?? 0) > 0) {
            throw error;
          }
          source = "content-fallback";
          useContentFallback = true;
          return listManifestPageFromContent(context, args);
        });
    pages.push(...result.page);
    isDone = result.isDone;
    cursor = result.continueCursor;
  }
  // Index choice must not change response order or validators. Public rows
  // with unset/false sensitivity arrive in separate index groups.
  pages.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  return { pages, source };
}

type PublicSnapshot = { hash: string; read: () => Promise<BodyInit> };

// Decode and verify the public snapshot (shape, site, scope, no restricted
// pages, content hash), memoized per hash. Anything that trusts the snapshot
// beyond serving its bytes goes through here.
function loadVerifiedBase(context: WikiApiContext, snapshot: PublicSnapshot) {
  const loadBase = async () => {
    const json = await new Response(await snapshot.read()).text();
    const raw = JSON.parse(json) as WikiManifest;
    parseWikiManifest(raw);
    const core = { schemaVersion: raw.schemaVersion, siteSlug: raw.siteSlug, scope: raw.scope,
      compactTree: raw.compactTree, pages: raw.pages, assets: raw.assets };
    if (raw.siteSlug !== context.siteSlug || raw.scope !== "public" || raw.pages.some(page => page.sensitive) ||
        raw.manifestHash !== snapshot.hash || hashJson(core) !== snapshot.hash) throw new Error("Invalid public base");
    return { raw, bytes: json.length };
  };
  return context.manifestSnapshotCache
    ? context.manifestSnapshotCache.get("base", `${context.siteSlug}:${snapshot.hash}`, loadBase, base => base.bytes)
    : loadBase();
}

// Reuse only a verified, revision-fenced public base. Private metadata and asset
// permissions are read afresh for this user; no session result enters shared cache.
async function sessionManifestPages(context: WikiApiContext, user: WikiApiSessionUser): Promise<ManifestPages> {
  if (context.getManifestSnapshot && context.access?.listAllowedManifestPage) {
    let failure: Parameters<NonNullable<WikiApiContext["onManifestFallback"]>>[0] = "snapshot-unavailable";
    try {
      const snapshot = await context.getManifestSnapshot();
      if (!snapshot || snapshot.revision === undefined) throw new Error("No versioned snapshot");
      failure = "snapshot-invalid";
      // The verified base is immutable for its hash; only the private overlay
      // and the revision fence below run per request.
      const { raw } = await loadVerifiedBase(context, snapshot);
      failure = "private-query";
      const overlay: WikiManifestPage[] = [];
      let cursor: string | null = null;
      const cursors = new Set<string>();
      for (;;) {
        const result = await context.access.listAllowedManifestPage(user, { cursor, numItems: MANIFEST_PAGE_SIZE });
        overlay.push(...result.page);
        if (result.isDone) break;
        if (!result.continueCursor || cursors.has(result.continueCursor)) throw new Error("Invalid private cursor");
        cursor = result.continueCursor;
        cursors.add(cursor);
      }
      failure = "snapshot-changed";
      const current = await context.getManifestSnapshot();
      if (!current || current.revision !== snapshot.revision || current.hash !== snapshot.hash) throw new Error("Public base changed");
      const pages = [...raw.pages, ...overlay];
      if (new Set(pages.map(page => page.slug)).size !== pages.length) throw new Error("Manifest membership changed");
      pages.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
      // `overlay` is exactly what this user's fresh access query returned; with
      // the base hash it fully determines `pages`.
      return { pages, source: "snapshot-overlay" as const, base: { hash: snapshot.hash, overlay } };
    } catch {
      try { context.onManifestFallback?.(failure); } catch { /* Telemetry cannot break fallback. */ }
      // Older backends, corrupt snapshots and concurrent publishes use the live oracle.
    }
  }
  return listManifestPages(context, Boolean(context.access));
}

async function boundedManifestFallback(
  context: WikiApiContext,
  includeSensitive: boolean,
) {
  const args = {
    cursor: null,
    numItems: MANIFEST_FALLBACK_PAGE_SIZE,
    ...(includeSensitive ? { includeSensitive: true } : {}),
  };
  const pageResult = await withTimeout(
    listManifestPageFromContent(context, args),
    MANIFEST_BOUNDED_FALLBACK_TIMEOUT_MS,
    "Wiki bounded manifest page fallback",
  );
  const priorityPages = await priorityManifestPages(
    context,
    includeSensitive,
    pageResult.page.map((page) => page.slug),
  );
  const assetArgs = {
    cursor: null,
    numItems: 100,
    ...(includeSensitive ? { includeSensitive: true } : {}),
  };
  const assets = await withTimeout(
    context.documents.listPdfAssetVisibilityPage(assetArgs),
    MANIFEST_BOUNDED_FALLBACK_TIMEOUT_MS,
    "Wiki bounded manifest asset fallback",
  )
    .then((result) =>
      result.page.map((asset) => ({
        kind: "pdf" as const,
        path: asset.path,
        contentHash: null,
        size: null,
        ownerSlugs: asset.ownerSlugs,
        sensitive: asset.sensitive,
      })),
    )
    .catch((error) => {
      context.logger?.warn("[wiki manifest] Bounded asset fallback unavailable", error);
      return [] as ManifestAssetCandidate[];
    });

  return {
    pages: [...pageResult.page, ...priorityPages],
    assets,
    source: "bounded-content-fallback" as const,
  };
}

async function priorityManifestPages(
  context: WikiApiContext,
  includeSensitive: boolean,
  existingSlugs: string[],
) {
  const seen = new Set(existingSlugs);
  const slugs = [
    ...new Set(
      (context.manifestPrioritySlugs ?? [])
        .map((slug) => slug.trim().replace(/^\/+/, ""))
        .filter((slug) => slug.length > 0 && !seen.has(slug)),
    ),
  ];
  if (slugs.length === 0) return [];

  const argsForSlug = (slug: string) =>
    includeSensitive ? { slug, includeSensitive: true as const } : { slug };
  const records = await withTimeout(
    (signal) => {
      const documents = cancellableContext(context, signal).documents;
      return Promise.allSettled(
        slugs.map(async (slug) => {
          const exact = await documents.getBySlug(argsForSlug(slug));
          if (exact || slug.endsWith("/index")) return exact;
          return documents.getBySlug(argsForSlug(`${slug}/index`));
        }),
      );
    },
    MANIFEST_BOUNDED_FALLBACK_TIMEOUT_MS,
    "Wiki bounded manifest priority fallback",
  ).catch((error) => {
    context.logger?.warn("[wiki manifest] Bounded priority fallback unavailable", error);
    return [] as PromiseSettledResult<PageWithContent | null>[];
  });

  const pages: WikiManifestPage[] = [];
  for (const result of records) {
    if (result.status !== "fulfilled" || !result.value) continue;
    if (seen.has(result.value.slug)) continue;
    seen.add(result.value.slug);
    pages.push(manifestPageFromContent(result.value));
  }
  return pages;
}

async function listManifestPageFromContent(
  context: WikiApiContext,
  args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  },
): Promise<ManifestPageResult> {
  const result = await context.documents.listPageWithContent(args);
  return {
    page: result.page.map(manifestPageFromContent),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

async function listAssets(
  context: WikiApiContext,
  includeSensitive: boolean,
  user: WikiApiSessionUser | null,
): Promise<{ assets: WikiManifestAsset[]; complete: boolean }> {
  const listVisibleAssets = async (
    kind: WikiManifestAsset["kind"],
    fetchPage: (args: {
      cursor: string | null;
      numItems: number;
      includeSensitive?: boolean;
    }) => Promise<AssetVisibilityResult>,
  ) => {
    const assets: ManifestAssetCandidate[] = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const result = await fetchPage({
        cursor,
        numItems: ASSET_PAGE_SIZE,
        ...(includeSensitive ? { includeSensitive: true } : {}),
      });
      assets.push(
        ...result.page.map((asset) => ({
          kind,
          path: asset.path,
          contentHash: null,
          size: null,
          ownerSlugs: asset.ownerSlugs,
          sensitive: asset.sensitive,
        })),
      );
      isDone = result.isDone;
      cursor = result.continueCursor;
    }
    return assets;
  };

  try {
    const assets = await listVisibleAssets(
      "pdf",
      (args) => context.documents.listPdfAssetVisibilityPage(args),
    );
    return {
      assets: !includeSensitive
        ? assets.map(publicManifestAsset)
        : await filterAssetsForUser(context, user, assets),
      complete: true,
    };
  } catch (error) {
    context.logger?.warn(
      "[wiki manifest] Asset ownership metadata unavailable; omitting assets",
      error,
    );
    return { assets: [], complete: false };
  }
}

function parseLimit(url: URL) {
  const raw = Number(url.searchParams.get("limit") ?? DEFAULT_PAGE_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(raw)));
}

function parseSlugs(url: URL) {
  return (url.searchParams.get("slugs") ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean)
    .slice(0, MAX_PAGE_LIMIT);
}

/** Race work against a deadline. When given a factory, the losing work's
 * signal is aborted so cancellation-aware loops stop issuing further reads
 * instead of paginating long after the response was sent. */
export function withTimeout<T>(
  work: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const promise = typeof work === "function" ? work(controller.signal) : work;
  // The loser may still reject after the race settles; never leave it unhandled.
  promise.catch(() => undefined);

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

/** A view of the context whose gateway/access calls fail fast once `signal`
 * aborts. Paginated readers check nothing themselves; their next page read
 * throws, ending the loop. In-flight calls are bounded by the transport. */
export function cancellableContext(context: WikiApiContext, signal: AbortSignal): WikiApiContext {
  const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
      return fn(...args);
    };
  const wrap = <O extends object>(target: O): O => new Proxy(target, {
    get(object, key, receiver) {
      const value = Reflect.get(object, key, receiver);
      return typeof value === "function"
        ? guard((...args: unknown[]) => (value as (...a: unknown[]) => Promise<unknown>).apply(object, args))
        : value;
    },
  });
  return {
    ...context,
    documents: wrap(context.documents),
    ...(context.access ? { access: wrap(context.access) } : {}),
    ...(context.getManifestSnapshot ? { getManifestSnapshot: guard(context.getManifestSnapshot) } : {}),
  };
}

export async function createWikiSessionResponse(
  request: Request,
  context: WikiApiContext,
) {
  const scope = requestedScope(request);

  if (scope === "public") {
    const identity = context.publicIdentity ?? makePublicWikiSessionIdentity(context.siteSlug);
    return Response.json(identity, {
      headers: decorate(context, {
        "Cache-Control": "public, max-age=300",
        Vary: "Accept, x-site-slug",
        "X-Wiki-Cache-Scope": "public",
      }),
    });
  }

  const sessionUser = await context.getSessionUser(request);
  if (!sessionUser) {
    // Automatic readers can select public in this same response. This decision
    // depends on the current cookie, so even its public result is never shared.
    if (new URL(request.url).searchParams.get("fallback") === "public") {
      return Response.json(context.publicIdentity ?? makePublicWikiSessionIdentity(context.siteSlug), {
        headers: decorate(context, {
          "Cache-Control": "private, no-store",
          Vary: "Accept, Cookie, x-site-slug",
          "X-Wiki-Cache-Scope": "public",
        }),
      });
    }
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: decorate(context, {
          "Cache-Control": "private, no-store",
          "X-Wiki-Cache-Scope": "session",
        }),
      },
    );
  }

  const allowedSlugs = context.access
    ? await context.access.getAllowedSlugs(sessionUser).catch((error) => {
        context.logger?.warn("[wiki session] Failed to compute access-aware cache key", error);
        return [] as string[];
      })
    : [];
  const accessHash = hashJson([...allowedSlugs].sort());
  const hash = userHash(context.siteSlug, `${sessionUser._id}:${accessHash}`);
  const identity: WikiSessionIdentity = {
    siteSlug: context.siteSlug,
    scope,
    authenticated: true,
    cacheVersion: WIKI_SESSION_CACHE_VERSION,
    cacheKey: `${context.siteSlug}:session:${hash}:${WIKI_SESSION_CACHE_VERSION}`,
    userHash: hash,
  };

  return Response.json(identity, {
    headers: decorate(context, {
      "Cache-Control": "private, no-store",
      Vary: "Accept, Cookie, x-site-slug",
      "X-Wiki-Cache-Scope": "session",
    }),
  });
}

export async function createWikiManifestResponse(
  request: Request,
  context: WikiApiContext,
) {
  context = withManifestAccessCache(context);
  const scope = requestedScope(request);
  const sessionUser = await requireSessionIfNeeded(request, context, scope);

  if (scope === "session" && !sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: decorate(context, { "Cache-Control": "private, no-store" }),
      },
    );
  }

  const phase = (name: Parameters<NonNullable<WikiApiContext["onManifestPhase"]>>[0], started: number) => {
    try { context.onManifestPhase?.(name, performance.now() - started); } catch { /* Profiling cannot fail readers. */ }
  };
  if (scope === "public" && context.getManifestSnapshot) {
    try {
      const snapshot = await context.getManifestSnapshot();
      if (snapshot && context.publicSubset) {
        // Any doubt (unverifiable snapshot, parse failure) throws to the live path.
        return await subsetManifestResponse(request, context, snapshot, context.publicSubset, phase);
      }
      if (snapshot) {
        const headers = representationHeaders(decorate(context, { ...cacheHeaders(scope, snapshot.hash), "Content-Type": "application/json", "X-Wiki-Manifest-Source": "snapshot" }));
        // The validator is the snapshot hash, so revalidation needs no storage read.
        if (ifNoneMatchMatches(request, snapshot.hash)) return new Response(null, { status: 304, headers });
        const compact = new URL(request.url).searchParams.get("format") === "compact-v1";
        const gzipAccepted = acceptsGzip(request);
        const encode = async () => {
          const bytes = await snapshot.read();
          // Decode, compact, re-serialize and compress depend only on the hash,
          // the wire format and the negotiated encoding.
          const encodeStarted = performance.now();
          const json = await new Response(bytes).text();
          const encoded = await encodeContent(
            compact ? JSON.stringify(compactWikiManifest(parseWikiManifest(JSON.parse(json)))) : json,
            gzipAccepted);
          phase("snapshot-encode", encodeStarted);
          return encoded;
        };
        const encoded = context.manifestSnapshotCache
          ? await context.manifestSnapshotCache.get("response",
              `${context.siteSlug}:${snapshot.hash}:${compact ? "compact-v1" : "full"}:${gzipAccepted ? "gzip" : "identity"}`,
              encode, value => typeof value.body === "string" ? value.body.length : value.body.byteLength)
          : await encode();
        return encodedResponse(encoded, headers);
      }
    } catch {
      // A missing, stale, failed or retired snapshot uses the normal live path.
      // Never serve stale visibility metadata just to keep the fast path running.
    }
  }
  const readStarted = performance.now();
  const includeSensitive = scope === "session" && Boolean(sessionUser);
  let pageResult: Awaited<ReturnType<typeof listManifestPages>>;
  let assets: WikiManifestAsset[];
  let partialManifest = false;
  try {
    const [nextPageResult, assetResult] = await withTimeout(
      (signal) => {
        const live = cancellableContext(context, signal);
        // Separate phases show which side of the parallel read is the long pole.
        const timed = async <T,>(name: "overlay" | "assets", work: Promise<T>) => {
          const started = performance.now();
          try { return await work; } finally { phase(name, started); }
        };
        return Promise.all([
          timed("overlay", includeSensitive && sessionUser ? sessionManifestPages(live, sessionUser) : listManifestPages(live, false)),
          timed("assets", listAssets(live, includeSensitive && Boolean(context.access), sessionUser)),
        ]);
      },
      MANIFEST_TIMEOUT_MS,
      "Wiki manifest generation",
    );
    pageResult = nextPageResult;
    assets = assetResult.assets;
    partialManifest = !assetResult.complete;
  } catch (error) {
    context.logger?.warn("[wiki manifest] Full manifest unavailable; using bounded fallback", error);
    try {
      const fallback = await boundedManifestFallback(context, includeSensitive && Boolean(context.access));
      pageResult = { pages: fallback.pages, source: fallback.source };
      assets = includeSensitive && context.access
        ? await filterAssetsForUser(context, sessionUser, fallback.assets)
        : fallback.assets.map(publicManifestAsset);
      partialManifest = true;
    } catch (fallbackError) {
      context.logger?.error("[wiki manifest] Reliable manifest metadata unavailable", fallbackError);
      return Response.json(
        { error: "Reliable wiki manifest metadata is unavailable" },
        { status: 503, headers: decorate(context, { "Cache-Control": "no-store" }) },
      );
    }
  }
  phase("read", readStarted);
  const { source } = pageResult;
  let pages = pageResult.pages;
  if (source !== "snapshot-overlay") {
    const filterStarted = performance.now();
    pages = await filterReadablePages(context, sessionUser, pageResult.pages);
    phase("filter", filterStarted);
  }
  // snapshot-overlay rows are the verified public base plus this request's own
  // fresh allowed-pages query, so re-checking them one by one adds nothing.

  const derive = () => {
    const treeStarted = performance.now();
    const compactTree = buildCompactTreeFromManifest(pages, assets);
    phase("tree", treeStarted);
    const manifestCore = {
      schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION,
      siteSlug: context.siteSlug,
      scope,
      compactTree,
      pages,
      assets,
    };
    const hashStarted = performance.now();
    const manifestHash = hashJson(manifestCore);
    phase("hash", hashStarted);
    return { ...manifestCore, manifestHash, generatedAt: new Date().toISOString() } satisfies WikiManifest;
  };
  // A session response is a pure function of the verified public base and this
  // request's freshly read overlay rows and assets. Key the memo by the content
  // of those fresh inputs (never by user identity): access was just evaluated,
  // so a revoked or changed grant yields different inputs and a different key.
  const derivedKey = pageResult.base && !partialManifest && context.manifestSnapshotCache
    ? `${context.siteSlug}:session:${pageResult.base.hash}:${fullHashJson([pageResult.base.overlay.slice().sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0), assets])}`
    : null;
  return serveDerivedManifest(request, context, { scope, source, partial: partialManifest, derive, key: derivedKey, phase });
}

type DerivedManifestOptions = {
  scope: WikiScope;
  source: string;
  partial: boolean;
  derive: () => WikiManifest | Promise<WikiManifest>;
  /** Memo key for derive() and its encoded forms. null disables caching. */
  key: string | null;
  phase: (name: "serialize", started: number) => void;
};

// Shared tail: validator check, serialization and per-format/encoding bytes.
async function serveDerivedManifest(request: Request, context: WikiApiContext, options: DerivedManifestOptions) {
  const { scope, key } = options;
  const cache = key ? context.manifestSnapshotCache : undefined;
  let computed = false;
  const derive = async () => { computed = true; return options.derive(); };
  const manifest = cache
    ? await cache.get("derived", key!, derive, value => value.pages.length * 300 + value.assets.length * 120)
    : await derive();
  const responseCacheHeaders = options.partial
    ? provisionalManifestHeaders(scope, manifest.manifestHash)
    : cacheHeaders(scope, manifest.manifestHash);
  // A memoized derivation reports `-cached` so traces separate the two costs.
  const source = cache && !computed ? `${options.source}-cached` : options.source;
  const headers = decorate(context, { ...responseCacheHeaders, "X-Wiki-Manifest-Source": source });
  if (ifNoneMatchMatches(request, manifest.manifestHash)) {
    return new Response(null, { status: 304, headers: representationHeaders(headers) });
  }
  const compact = new URL(request.url).searchParams.get("format") === "compact-v1";
  const gzipAccepted = acceptsGzip(request);
  const encode = async () => {
    const started = performance.now();
    const encoded = await encodeContent(manifestJson(request, manifest), gzipAccepted);
    options.phase("serialize", started);
    return encoded;
  };
  const encoded = cache
    ? await cache.get("response", `${key}:${compact ? "compact-v1" : "full"}:${gzipAccepted ? "gzip" : "identity"}`,
        encode, value => typeof value.body === "string" ? value.body.length : value.body.byteLength)
    : await encode();
  return encodedResponse(encoded, headers);
}

// A public subset (education) filtered out of the verified public snapshot and
// rebuilt/hashed the way the live path does, so its validator is identical.
async function subsetManifestResponse(
  request: Request,
  context: WikiApiContext,
  snapshot: PublicSnapshot,
  subset: WikiPublicSubset,
  phase: (name: "snapshot-derive" | "serialize", started: number) => void,
) {
  const { raw } = await loadVerifiedBase(context, snapshot);
  const derive = () => {
    const started = performance.now();
    const pages = raw.pages.filter(page => subset.includePage(page));
    const assets = raw.assets.filter(asset => subset.includeAsset(asset));
    const core = { schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION, siteSlug: context.siteSlug, scope: "public" as const,
      compactTree: buildCompactTreeFromManifest(pages, assets), pages, assets };
    const manifest: WikiManifest = { ...core, manifestHash: hashJson(core), generatedAt: raw.generatedAt };
    phase("snapshot-derive", started);
    return manifest;
  };
  return serveDerivedManifest(request, context, { scope: "public", source: `snapshot-${subset.name}`, partial: false, derive,
    key: context.manifestSnapshotCache ? `${context.siteSlug}:${snapshot.hash}:${subset.name}` : null, phase });
}

export async function createWikiPagesResponse(
  request: Request,
  context: WikiApiContext,
) {
  const url = new URL(request.url);
  const scope = requestedScope(request);
  const sessionUser = await requireSessionIfNeeded(request, context, scope);

  if (scope === "session" && !sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: decorate(context, { "Cache-Control": "private, no-store" }),
      },
    );
  }

  const includeSensitive = scope === "session" && Boolean(sessionUser) && Boolean(context.access);
  const slugs = parseSlugs(url);
  let pages: WikiPageRecord[] = [];
  let unavailable: WikiUnavailablePage[] = [];
  let isDone = true;
  let continueCursor: string | null = null;

  if (slugs.length > 0) {
    // One includeSensitive read per candidate covers both public and
    // restricted rows (the gateway may still narrow it, e.g. education), then
    // one batched access check decides which restricted rows become stubs.
    const found = await mapWithConcurrency(slugs, PAGE_LOOKUP_CONCURRENCY, async (slug) => {
      const candidates = slug.endsWith("/index") ? [slug] : [slug, `${slug}/index`];
      for (const candidate of candidates) {
        const page = await context.documents.getBySlug({ slug: candidate, includeSensitive: true });
        if (page) return page;
      }
      return null;
    });
    const access = await accessBySlug(
      context,
      sessionUser,
      found.filter((page): page is PageWithContent => page?.sensitive === true).map((page) => page.slug),
    );
    const records = found.map((page) => {
      if (!page) return { page: null, unavailable: null };
      if (page.sensitive !== true || access.get(page.slug)?.allowed === true) {
        return { page, unavailable: null };
      }
      return { page: null, unavailable: unavailablePageFromContent(page) };
    });
    pages = records
      .map((record) => record.page)
      .filter((page): page is PageWithContent => Boolean(page))
      .map(pageRecord);
    unavailable = records
      .map((record) => record.unavailable)
      .filter((page): page is WikiUnavailablePage => Boolean(page));
  } else {
    const limit = parseLimit(url);
    let cursor = url.searchParams.get("cursor");
    isDone = false;

    while (!isDone && pages.length < limit) {
      const result = await context.documents.listPageWithContent({
        cursor,
        numItems: limit - pages.length,
        ...(includeSensitive ? { includeSensitive: true } : {}),
      });

      const readable = await filterReadablePages(context, sessionUser, result.page);
      pages.push(...readable.map(pageRecord));
      isDone = result.isDone;
      cursor = result.continueCursor;

      if (!isDone && !cursor) {
        throw new Error("Wiki page pagination did not return a continuation cursor");
      }
    }

    continueCursor = isDone ? null : cursor;
  }

  const body: WikiPageBatch = {
    siteSlug: context.siteSlug,
    generatedAt: new Date().toISOString(),
    scope,
    pages,
    ...(unavailable.length > 0 ? { unavailable } : {}),
    isDone,
    continueCursor,
  };
  const etag = hashJson({
    siteSlug: body.siteSlug,
    scope,
    slugs,
    pages: pages.map((page) => [page.slug, page.contentHash, page.size]),
    unavailable: unavailable.map((page) => [page.slug, page.contentHash, page.size, page.reason]),
    isDone,
    continueCursor,
  });

  if (request.headers.get("if-none-match")?.includes(etag)) {
    return new Response(null, {
      status: 304,
      headers: representationHeaders(decorate(context, cacheHeaders(scope, etag))),
    });
  }

  return contentResponse(request, JSON.stringify(body), decorate(context, cacheHeaders(scope, etag)));
}
