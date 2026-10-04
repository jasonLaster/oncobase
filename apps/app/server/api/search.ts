import type { ConvexHttpClient } from "convex/browser";
import { applyPiiRedactions, type PiiPattern } from "@oncobase/wiki-content/pii";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { TEXT_SEARCH_LATENCY_BUDGET_MS } from "../../src/search-performance.js";
import { traceBackendAttributes, traceBackendCache, traceBackendPhase } from "../backend-tracing";
import { runAfterResponse } from "../background";
import { isEducationSlug } from "../education-access";
import { type SessionUser, getPiiPatterns, getSessionUser, withSiteSlug } from "../reader-access";
import {
  loadSensitiveSearchPages,
  overlaySearchPages,
  prepareSearchPage,
  readPublicSearchCorpus,
  redactionConfigurationKey,
  type AllowedSensitivePage,
  type PublicCorpusCache,
  type SearchablePage,
  type SensitivePageCache,
} from "../search-corpus";
import type { PageDownloadResult } from "./documents";

export const MAX_SEARCH_LIMIT = 5000;
// Text search needs complete line matches, so it scans the visible corpus
// rather than the relevance index. Keep the corpus in as few Convex round
// trips as practical; Diana's current reader set fits in one page.
export const SEARCH_DOCUMENT_PAGE_SIZE = 500;
export const SEARCH_CORPUS_CACHE_TTL_MS = 60_000;
// A settled public corpus is served while it reloads in the background, up to
// the public response's own CDN freshness (s-maxage=300).
export const SEARCH_CORPUS_MAX_STALE_MS = 300_000;
// Authorized sensitive metadata page size (listAllowedSensitiveManifestPage max).
export const SENSITIVE_SEARCH_PAGE_SIZE = 500;
export const PUBLIC_SEARCH_CORPUS_WAIT_MS = 15_000;
export const PUBLIC_SEARCH_RETRY_AFTER_MS = 5_000;
export const INDEXED_SEARCH_FALLBACK_LIMIT = 100;

// Vite development intentionally runs React effects twice. Keep concurrent
// public searches from downloading the same complete corpus twice, and retain
// the corpus for the same interval as the public search response. The client
// key keeps unit-test handlers and independently configured sites isolated.
export const publicSearchCorpusCache = new WeakMap<object, PublicCorpusCache>();
// Redacted sensitive page content keyed by site, slug and content hash. It is
// shared between readers only after their own fresh authorization of a slug.
export const sensitiveSearchPageCache = new WeakMap<object, Map<string, SensitivePageCache>>();

export async function loadPublicSearchCorpus(
  client: ConvexHttpClient,
  siteSlug: string,
  patterns: PiiPattern[] | undefined,
) {
  const pages: SearchablePage[] = [];
  const fetchPage = (cursor: string | null): Promise<PageDownloadResult> => client.query(
    api.documents.listPageWithContent,
    withSiteSlug(siteSlug, { cursor, numItems: SEARCH_DOCUMENT_PAGE_SIZE }),
  );
  let pending: Promise<PageDownloadResult> | null = fetchPage(null);
  while (pending) {
    const pageResult: PageDownloadResult = await pending;
    if (!pageResult.isDone && !pageResult.continueCursor) throw new Error("Search pagination failed");
    // Exactly one next read: overlap its network wait with current-page
    // preparation. Register rejection handling even if preparation fails.
    pending = pageResult.isDone ? null : fetchPage(pageResult.continueCursor);
    void pending?.catch(() => undefined);
    // The public read excludes sensitive documents in the backend.
    const visible = pageResult.page.filter(page => page.sensitive !== true);
    pages.push(...await traceBackendPhase("search.prepare", () => visible.map(page => prepareSearchPage(page, patterns))));
  }

  return pages;
}

export function getPublicSearchCorpus(
  client: ConvexHttpClient,
  siteSlug: string,
  patterns: PiiPattern[] | undefined,
) {
  let clientCache = publicSearchCorpusCache.get(client);
  if (!clientCache) {
    clientCache = new Map();
    publicSearchCorpusCache.set(client, clientCache);
  }
  const { pages, state } = readPublicSearchCorpus({
    cache: clientCache,
    key: siteSlug,
    redactionKey: redactionConfigurationKey(patterns),
    load: () => loadPublicSearchCorpus(client, siteSlug, patterns),
    now: Date.now(),
    freshMs: SEARCH_CORPUS_CACHE_TTL_MS,
    maxStaleMs: SEARCH_CORPUS_MAX_STALE_MS,
    background: task => runAfterResponse(task, "search corpus refresh"),
  });
  traceBackendCache("search-corpus", state !== "miss");
  if (state === "stale") traceBackendAttributes({ "search.corpus.stale": true });
  return pages;
}

// Authorization comes from one backend evaluation per metadata page, read
// afresh for every request; it is never cached.
export async function listAllowedSensitiveSearchPages(
  client: ConvexHttpClient,
  siteSlug: string,
  sessionUser: SessionUser,
) {
  const allowed: AllowedSensitivePage[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const result: { page: AllowedSensitivePage[]; isDone: boolean; continueCursor: string | null } = await client.query(
      api.access.listAllowedSensitiveManifestPage,
      withSiteSlug(siteSlug, { userId: sessionUser._id as Id<"users">, cursor, numItems: SENSITIVE_SEARCH_PAGE_SIZE }),
    );
    allowed.push(...result.page.map(({ slug, contentHash }) => ({ slug, contentHash })));
    if (result.isDone) return allowed;
    if (!result.continueCursor || cursors.has(result.continueCursor)) throw new Error("Search access pagination failed");
    cursor = result.continueCursor;
    cursors.add(cursor);
  }
}

export async function loadSessionSensitiveSearchPages(
  client: ConvexHttpClient,
  siteSlug: string,
  sessionUser: SessionUser,
  patterns: PiiPattern[] | undefined,
) {
  const allowed = await listAllowedSensitiveSearchPages(client, siteSlug, sessionUser);
  let clientCache = sensitiveSearchPageCache.get(client);
  if (!clientCache) {
    clientCache = new Map();
    sensitiveSearchPageCache.set(client, clientCache);
  }
  let cache = clientCache.get(siteSlug);
  if (!cache) {
    cache = new Map();
    clientCache.set(siteSlug, cache);
  }
  const { pages, hits, fetched } = await loadSensitiveSearchPages({
    allowed,
    // Only slugs the backend has just authorized for this reader.
    fetchPage: slug => client.query(api.documents.getBySlug, withSiteSlug(siteSlug, { slug, includeSensitive: true })),
    patterns,
    cache,
  });
  traceBackendAttributes({ "search.sensitive.allowed": allowed.length, "search.sensitive.cached": hits, "search.sensitive.fetched": fetched });
  return pages;
}

export async function getSearchCorpus(
  client: ConvexHttpClient,
  siteSlug: string,
  sessionUser: SessionUser | null,
  patterns: PiiPattern[] | undefined,
) {
  if (!sessionUser) return getPublicSearchCorpus(client, siteSlug, patterns);
  // Session corpus = shared public corpus + this reader's authorized sensitive
  // pages. Sensitive bodies the reader cannot read are never downloaded.
  const [publicPages, sensitivePages] = await Promise.all([
    getPublicSearchCorpus(client, siteSlug, patterns),
    loadSessionSensitiveSearchPages(client, siteSlug, sessionUser, patterns),
  ]);
  return overlaySearchPages(publicPages, sensitivePages);
}

export function publicSearchCorpusWaitMs() {
  const configured = Number(process.env.WIKI_SEARCH_CORPUS_WAIT_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : PUBLIC_SEARCH_CORPUS_WAIT_MS;
}

export async function waitForPublicSearchCorpus(pages: Promise<SearchablePage[]>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), publicSearchCorpusWaitMs());
  });
  try {
    return await Promise.race([pages, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function loadIndexedSearchResults(
  client: ConvexHttpClient,
  siteSlug: string,
  query: string,
  limit: number,
  patterns: PiiPattern[] | undefined,
) {
  const indexedLimit = Number.isFinite(limit)
    ? Math.min(INDEXED_SEARCH_FALLBACK_LIMIT, limit)
    : INDEXED_SEARCH_FALLBACK_LIMIT;
  const indexed = (await client.query(
    api.documents.search,
    withSiteSlug(siteSlug, { query, limit: indexedLimit }),
  )) as Array<{
    excerpt?: string;
    slug: string;
    tags?: string[];
    title: string;
  }>;

  return indexed.map((result) => ({
    filePath: result.slug,
    slug: result.slug,
    title: applyPiiRedactions(result.title, { patterns }),
    tags: result.tags,
    excerpt: applyPiiRedactions(result.excerpt ?? "", { patterns }),
  }));
}

export async function handleSearchRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
  educationOnly = false,
) {
  const startedAt = performance.now();
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "session" ? "session" : "public";
  const sessionUser = scope === "session" && !educationOnly
    ? await getSessionUser(request, client, siteSlug)
    : null;
  if (scope === "session" && !sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Accept, Cookie, Host",
          "X-Wiki-Cache-Scope": "session",
        },
      },
    );
  }

  const query = (url.searchParams.get("q") ?? "").trim();
  const limitParam = url.searchParams.get("limit");
  const rawLimit = limitParam == null ? Number.POSITIVE_INFINITY : Number(limitParam);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : Number.POSITIVE_INFINITY;

  const responseHeaders = new Headers(
    scope === "session"
      ? {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
          Vary: "Accept, Cookie, Host",
          "X-Wiki-Cache-Scope": "session",
        }
      : {
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
          Vary: "Accept, Host",
          "X-Wiki-Cache-Scope": "public",
        },
  );

  const timedResponseHeaders = (completeness = "exhaustive") => {
    const durationMs = Math.round(performance.now() - startedAt);
    const headers = new Headers(responseHeaders);
    headers.set("Server-Timing", `wiki-search;dur=${durationMs}`);
    headers.set("X-Wiki-Search-Budget-Ms", String(TEXT_SEARCH_LATENCY_BUDGET_MS));
    headers.set("X-Wiki-Search-Completeness", completeness);
    headers.set("X-Wiki-Search-Duration-Ms", String(durationMs));
    return headers;
  };

  if (query.length < 2) {
    return Response.json(
      { results: [] },
      { headers: timedResponseHeaders() },
    );
  }

  const includeSensitive = scope === "session" && Boolean(sessionUser);
  const patterns = await getPiiPatterns(client, siteSlug);
  const regex = new RegExp(escapeSearchRegex(query), "i");
  const results: Array<{
    filePath: string;
    slug: string;
    title: string;
    matches: Array<{
      lineNumber: number;
      lineContent: string;
      matchStart: number;
      matchEnd: number;
    }>;
  }> = [];
  const corpusPromise = traceBackendPhase("search.corpus", () => getSearchCorpus(
    client,
    siteSlug,
    includeSensitive ? sessionUser : null,
    patterns,
  ));
  const visiblePages = includeSensitive ? await corpusPromise : await waitForPublicSearchCorpus(corpusPromise);

  if (!visiblePages) {
    const indexedResults = await loadIndexedSearchResults(
      client,
      siteSlug,
      query,
      limit,
      patterns,
    );
    return Response.json(
      {
        results: educationOnly ? indexedResults.filter(page => isEducationSlug(page.slug)) : indexedResults,
        complete: false,
        retryAfterMs: PUBLIC_SEARCH_RETRY_AFTER_MS,
      },
      { headers: timedResponseHeaders("indexed") },
    );
  }

  // One linear pass: a single non-global exec per line (no lastIndex state),
  // no per-line array allocation. Ranking is by match count over the whole
  // visible corpus, so a limit cannot stop the scan early without changing
  // which pages are returned; it is applied after the sort.
  await traceBackendPhase("search.match", () => {
    for (const page of visiblePages) {
      if (educationOnly && !isEducationSlug(page.slug)) continue;
      const matches: (typeof results)[number]["matches"] = [];
      const { lines } = page;
      for (let index = 0; index < lines.length; index++) {
        const lineContent = lines[index]!;
        const match = regex.exec(lineContent);
        if (match) {
          matches.push({
            lineNumber: index + 1,
            lineContent,
            matchStart: match.index,
            matchEnd: match.index + match[0].length,
          });
        }
      }

      if (matches.length > 0) {
        results.push({
          filePath: page.slug,
          slug: page.slug,
          title: page.title,
          matches,
        });
      }
    }
  });

  results.sort((a, b) => b.matches.length - a.matches.length);
  const limitedResults = Number.isFinite(limit) ? results.slice(0, limit) : results;

  return Response.json(
    { results: limitedResults },
    { headers: timedResponseHeaders() },
  );
}

export function escapeSearchRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
