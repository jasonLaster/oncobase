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
  type PublicCorpusRead,
  type SearchablePage,
  type SensitivePageCache,
} from "../search-corpus";

export const MAX_SEARCH_LIMIT = 5000;
// Text search needs complete line matches, so it scans the visible corpus
// rather than the relevance index. The backend plans the corpus as slug ranges
// of bounded stored size (documents:searchCorpusPlan); read them concurrently.
// Each range read stays far below the backend RPC timeout.
export const SEARCH_CORPUS_CONCURRENCY = 8;
export const SEARCH_CORPUS_CACHE_TTL_MS = 60_000;
// A settled public corpus is served while it reloads in the background, up to
// the public response's own CDN freshness (s-maxage=300).
export const SEARCH_CORPUS_MAX_STALE_MS = 300_000;
// Authorized sensitive metadata page size (listAllowedSensitiveManifestPage max).
export const SENSITIVE_SEARCH_PAGE_SIZE = 500;
// A cold public search waits this long for the exhaustive corpus, then answers
// from the relevance index while the corpus keeps loading after the response.
export const PUBLIC_SEARCH_CORPUS_WAIT_MS = 1_500;
// The reader's background retry already shows indexed results, so it may wait
// for the corpus to finish loading on whichever instance receives it.
export const PUBLIC_SEARCH_EXHAUSTIVE_WAIT_MS = 15_000;
export const SEARCH_WAIT_HEADER = "X-Wiki-Search-Wait";
export const PUBLIC_SEARCH_RETRY_AFTER_MS = 1_000;
// Every indexed result is a whole-row backend read (body, raw body,
// embedding). The interim list only has to cover the first screen until the
// exhaustive results replace it.
export const INDEXED_SEARCH_FALLBACK_LIMIT = 30;

// Vite development intentionally runs React effects twice. Keep concurrent
// public searches from downloading the same complete corpus twice, and retain
// the corpus for the same interval as the public search response. The client
// key keeps unit-test handlers and independently configured sites isolated.
export const publicSearchCorpusCache = new WeakMap<object, PublicCorpusCache>();
// Redacted sensitive page content keyed by site, slug and content hash. It is
// shared between readers only after their own fresh authorization of a slug.
export const sensitiveSearchPageCache = new WeakMap<object, Map<string, SensitivePageCache>>();

type SearchCorpusRange = { partition: number; from: string | null; to: string | null; fingerprint: string | null };
type SearchCorpusPlan = { ranges: SearchCorpusRange[]; documents: number | null; planned: boolean };
type SearchPagesResult = {
  page: Array<{ slug: string; title: string; content: string; contentHash?: string }>;
  isDone: boolean;
  continueCursor: string;
};
/** How the cached public corpus was loaded. `ranges` holds each fingerprinted
 * range's prepared pages so a refresh re-reads only ranges that changed. */
export type SearchCorpusStats = {
  loadMs: number; prepareMs: number; rpcs: number; planned: boolean; characters: number;
  ranges: number; reusedRanges: number; rangePages: Map<string, SearchablePage[]>;
};
const searchCorpusStats = new WeakMap<SearchablePage[], SearchCorpusStats>();

export async function loadPublicSearchCorpus(
  client: ConvexHttpClient,
  siteSlug: string,
  patterns: PiiPattern[] | undefined,
  // The corpus this load replaces (same site and redaction configuration).
  previous?: SearchablePage[],
  concurrency = SEARCH_CORPUS_CONCURRENCY,
) {
  const started = performance.now();
  const plan: SearchCorpusPlan = await traceBackendPhase("search.corpus.plan", () =>
    client.query(api.documents.searchCorpusPlan, withSiteSlug(siteSlug, {})));
  const { ranges } = plan;
  const previousRanges = previous ? searchCorpusStats.get(previous)?.rangePages : undefined;
  const rangePages = new Map<string, SearchablePage[]>();
  const chunks: SearchablePage[][] = new Array(ranges.length);
  const pending: number[] = [];
  let characters = 0;
  ranges.forEach((range, index) => {
    const key = range.fingerprint && JSON.stringify([range.partition, range.from, range.to, range.fingerprint]);
    const reused = key ? previousRanges?.get(key) : undefined;
    if (reused) {
      chunks[index] = reused;
      for (const page of reused) characters += searchPageCharacters(page);
    } else {
      pending.push(index);
    }
    if (key) rangePages.set(key, reused ?? []);
  });
  let next = 0;
  let rpcs = 1;
  let prepareMs = 0;
  // One failed range fails the load; the other workers stop reading.
  let failed = false;
  await traceBackendPhase("search.corpus.fetch", () => Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      try {
        await readRanges();
      } catch (error) {
        failed = true;
        throw error;
      }
    }),
  ));
  async function readRanges() {
    while (next < pending.length && !failed) {
      const index = pending[next++]!;
      const { partition, from, to, fingerprint } = ranges[index]!;
      const pages: SearchablePage[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      for (;;) {
        const result: SearchPagesResult = await client.query(
          api.documents.listSearchPages,
          withSiteSlug(siteSlug, { partition, from, to, cursor }),
        );
        rpcs++;
        // Preparation is synchronous; other ranges' reads stay in flight.
        const prepareStarted = performance.now();
        for (const page of result.page) pages.push(prepareSearchPage(page, patterns));
        prepareMs += performance.now() - prepareStarted;
        // Yield between ranges: with reads completing back to back, Bun
        // otherwise defers due timers (the search wait budget) until the
        // whole load ends, and concurrent requests on the instance stall.
        await new Promise<void>(resolve => setImmediate(resolve));
        if (result.isDone) break;
        if (failed) return;
        if (!result.continueCursor || cursors.has(result.continueCursor)) throw new Error("Search pagination failed");
        cursor = result.continueCursor;
        cursors.add(cursor);
      }
      chunks[index] = pages;
      for (const page of pages) characters += searchPageCharacters(page);
      if (fingerprint) rangePages.set(JSON.stringify([partition, from, to, fingerprint]), pages);
    }
  }
  // Plan order (visibility partition, then slug) is the previous single
  // cursor's order, so equal-score ties keep their ranking.
  const pages = chunks.flat();
  searchCorpusStats.set(pages, {
    loadMs: Math.round(performance.now() - started), prepareMs: Math.round(prepareMs), rpcs, planned: plan.planned,
    characters, ranges: ranges.length, reusedRanges: ranges.length - pending.length, rangePages,
  });
  return pages;
}

function searchPageCharacters(page: SearchablePage) {
  let characters = 0;
  for (const line of page.lines) characters += line.length + 1;
  return characters;
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
  const read = readPublicSearchCorpus({
    cache: clientCache,
    key: siteSlug,
    redactionKey: redactionConfigurationKey(patterns),
    load: previous => loadPublicSearchCorpus(client, siteSlug, patterns, previous),
    now: Date.now(),
    freshMs: SEARCH_CORPUS_CACHE_TTL_MS,
    maxStaleMs: SEARCH_CORPUS_MAX_STALE_MS,
    background: task => runAfterResponse(task, "search corpus refresh"),
  });
  traceBackendCache("search-corpus", read.state !== "miss");
  traceBackendAttributes({ "search.corpus.state": read.state });
  return read;
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

export function getSearchCorpus(
  client: ConvexHttpClient,
  siteSlug: string,
  sessionUser: SessionUser | null,
  patterns: PiiPattern[] | undefined,
): PublicCorpusRead {
  const publicCorpus = getPublicSearchCorpus(client, siteSlug, patterns);
  if (!sessionUser) return publicCorpus;
  // Session corpus = shared public corpus + this reader's authorized sensitive
  // pages. Sensitive bodies the reader cannot read are never downloaded.
  const pages = Promise.all([
    publicCorpus.pages,
    loadSessionSensitiveSearchPages(client, siteSlug, sessionUser, patterns),
  ]).then(([publicPages, sensitivePages]) => {
    const overlaid = overlaySearchPages(publicPages, sensitivePages);
    const stats = searchCorpusStats.get(publicPages);
    if (stats) searchCorpusStats.set(overlaid, stats);
    return overlaid;
  });
  return { pages, state: publicCorpus.state };
}

export function publicSearchCorpusWaitMs() {
  const configured = Number(process.env.WIKI_SEARCH_CORPUS_WAIT_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : PUBLIC_SEARCH_CORPUS_WAIT_MS;
}

/** The corpus, or null once `waitMs` passes first. */
export async function waitForPublicSearchCorpus(pages: Promise<SearchablePage[]>, waitMs = publicSearchCorpusWaitMs()) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), waitMs);
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
  const corpus = getSearchCorpus(
    client,
    siteSlug,
    includeSensitive ? sessionUser : null,
    patterns,
  );
  // Session search never falls back to the public index: it waits for the
  // reader's own corpus. Public search waits a short budget, or the long one
  // when the reader is already showing indexed results and retries.
  const waitKind = includeSensitive
    ? "unbounded"
    : request.headers.get(SEARCH_WAIT_HEADER) === "exhaustive" ? "exhaustive" : "short";
  const waitMs = waitKind === "exhaustive" ? PUBLIC_SEARCH_EXHAUSTIVE_WAIT_MS : publicSearchCorpusWaitMs();
  traceBackendAttributes({
    "search.scope": scope,
    "search.wait": waitKind,
    ...(waitKind === "unbounded" ? {} : { "search.corpus.wait_budget_ms": waitMs }),
  });
  const visiblePages = await traceBackendPhase("search.corpus", () => includeSensitive
    ? corpus.pages
    : waitForPublicSearchCorpus(corpus.pages, waitMs));

  if (!visiblePages) {
    // Keep the corpus load alive after the response (Vercel would otherwise
    // freeze the instance), so this instance's next search is exhaustive.
    runAfterResponse(corpus.pages, "search corpus warm");
    traceBackendAttributes({ "search.mode": "indexed", "search.corpus.wait": "budget-exceeded" });
    const indexedResults = await traceBackendPhase("search.indexed", () => loadIndexedSearchResults(
      client,
      siteSlug,
      query,
      limit,
      patterns,
    ));
    const results = educationOnly ? indexedResults.filter(page => isEducationSlug(page.slug)) : indexedResults;
    traceBackendAttributes({ "search.results": results.length });
    const headers = timedResponseHeaders("indexed");
    // Interim results: never let a browser or CDN cache replay them to the
    // reader's retry (or anyone else) in place of the exhaustive response.
    headers.set("Cache-Control", "no-store");
    return Response.json(
      {
        results,
        complete: false,
        retryAfterMs: PUBLIC_SEARCH_RETRY_AFTER_MS,
      },
      { headers },
    );
  }

  const stats = searchCorpusStats.get(visiblePages);
  traceBackendAttributes({
    "search.mode": corpus.state === "stale" ? "stale-exhaustive" : "exhaustive",
    "search.corpus.wait": waitKind === "unbounded" ? "unbounded" : "ready",
    "search.corpus.pages": visiblePages.length,
    ...(stats ? {
      "search.corpus.characters": stats.characters,
      "search.corpus.load_ms": stats.loadMs,
      "search.corpus.prepare_ms": stats.prepareMs,
      "search.corpus.rpcs": stats.rpcs,
      "search.corpus.ranges": stats.ranges,
      "search.corpus.reused_ranges": stats.reusedRanges,
      "search.corpus.planned": stats.planned,
    } : {}),
  });

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
  traceBackendAttributes({ "search.results": limitedResults.length });

  return Response.json(
    { results: limitedResults },
    { headers: timedResponseHeaders() },
  );
}

export function escapeSearchRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
