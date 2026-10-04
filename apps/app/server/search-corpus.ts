import { applyPiiRedactions, type PiiPattern } from "@oncobase/wiki-content/pii";

export type SearchablePage = { slug: string; title: string; lines: string[] };

export function redactionConfigurationKey(patterns: PiiPattern[] | undefined) {
  return patterns === undefined ? "diana-defaults" : JSON.stringify(patterns.map(({ pattern, replacement }) => [pattern.source, pattern.flags, replacement]));
}

// Prepare incrementally as each database page arrives. The cache retains only
// searchable, redacted lines rather than both raw and prepared corpus copies.
export function prepareSearchPage(page: { slug: string; title: string; content: string }, patterns: PiiPattern[] | undefined): SearchablePage {
  return {
    slug: page.slug,
    title: applyPiiRedactions(page.title, { patterns }),
    lines: applyPiiRedactions(page.content, { patterns }).split("\n"),
  };
}

type PublicCorpusEntry = {
  redactionKey: string;
  // Load start time: freshness is measured from the read, as before.
  loadedAt: number;
  pages: Promise<SearchablePage[]>;
  // Set once `pages` resolves; only a settled corpus may be served stale.
  value?: SearchablePage[];
  refresh?: Promise<unknown>;
};

export type PublicCorpusCache = Map<string, PublicCorpusEntry>;

export type PublicCorpusRead = {
  pages: Promise<SearchablePage[]>;
  state: "fresh" | "stale" | "miss";
  // `pages` is already resolved (a fresh entry may still be loading).
  settled: boolean;
};

/**
 * Per-instance public corpus with stale-while-revalidate. Within `freshMs` a
 * corpus is served as is. Up to `maxStaleMs` a settled corpus is still served
 * immediately while one background reload replaces it, so a search never waits
 * a full corpus read when a previous one exists. Public responses are already
 * CDN-cacheable for longer than `maxStaleMs`. A redaction change is never
 * served stale: the corpus holds redacted lines and must be rebuilt.
 */
export function readPublicSearchCorpus({
  cache, key, redactionKey, load, now, freshMs, maxStaleMs, background,
}: {
  cache: PublicCorpusCache;
  key: string;
  redactionKey: string;
  // A refresh receives the settled corpus it replaces, to reuse what is unchanged.
  load: (previous?: SearchablePage[]) => Promise<SearchablePage[]>;
  now: number;
  freshMs: number;
  maxStaleMs: number;
  background: (promise: Promise<unknown>) => void;
}): PublicCorpusRead {
  const start = (previous?: SearchablePage[]): PublicCorpusEntry => {
    const entry: PublicCorpusEntry = { redactionKey, loadedAt: now, pages: load(previous) };
    entry.pages.then(value => { entry.value = value; }, () => undefined);
    return entry;
  };
  const cached = cache.get(key);
  const usable = cached?.redactionKey === redactionKey ? cached : undefined;
  const age = usable ? now - usable.loadedAt : Number.POSITIVE_INFINITY;
  if (usable && age <= freshMs) return { pages: usable.pages, state: "fresh", settled: usable.value !== undefined };

  if (usable?.value && age <= maxStaleMs) {
    if (!usable.refresh) {
      const next = start(usable.value);
      usable.refresh = next.pages.then(
        () => { if (cache.get(key) === usable) cache.set(key, next); },
        // Keep serving the previous corpus; the next search retries.
        () => { usable.refresh = undefined; },
      );
      background(usable.refresh);
    }
    return { pages: Promise.resolve(usable.value), state: "stale", settled: true };
  }

  const entry = start();
  cache.set(key, entry);
  // A failed cold read is not retained; the next search retries it.
  entry.pages.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  return { pages: entry.pages, state: "miss", settled: false };
}

export type AllowedSensitivePage = { slug: string; contentHash?: string | null };
export type SensitivePageContent = { slug: string; title: string; content: string; contentHash?: string | null; sensitive?: boolean } | null;
type PreparedSensitivePage = { contentHash: string; redactionKey: string; page: SearchablePage };
export type SensitivePageCache = Map<string, PreparedSensitivePage>;

const SENSITIVE_PAGE_CACHE_LIMIT = 5000;
const SENSITIVE_PAGE_FETCH_CONCURRENCY = 16;

/**
 * Prepared sensitive pages for exactly the slugs the backend has just
 * authorized for this user. Access is never cached: `allowed` is read afresh
 * per request. Only redacted page content is shared between users, keyed by
 * slug, content hash and redaction configuration, so a reader can obtain a
 * cached page only when the backend authorized that slug for them and the
 * stored document still has the same content hash.
 */
export async function loadSensitiveSearchPages({
  allowed, fetchPage, patterns, cache, concurrency = SENSITIVE_PAGE_FETCH_CONCURRENCY,
}: {
  allowed: AllowedSensitivePage[];
  fetchPage: (slug: string) => Promise<SensitivePageContent>;
  patterns: PiiPattern[] | undefined;
  cache: SensitivePageCache;
  concurrency?: number;
}) {
  const redactionKey = redactionConfigurationKey(patterns);
  const pages: Array<SearchablePage | null> = new Array(allowed.length).fill(null);
  const missing: number[] = [];
  let hits = 0;
  allowed.forEach(({ slug, contentHash }, index) => {
    const cached = contentHash ? cache.get(slug) : undefined;
    if (cached && cached.contentHash === contentHash && cached.redactionKey === redactionKey) {
      pages[index] = cached.page;
      hits += 1;
    } else {
      missing.push(index);
    }
  });

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
    while (next < missing.length) {
      const index = missing[next++]!;
      const document = await fetchPage(allowed[index]!.slug);
      // Deleted since authorization: omit, as the corpus read would have.
      if (!document) continue;
      const page = prepareSearchPage(document, patterns);
      pages[index] = page;
      if (document.contentHash) {
        cache.delete(document.slug);
        cache.set(document.slug, { contentHash: document.contentHash, redactionKey, page });
        if (cache.size > SENSITIVE_PAGE_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      }
    }
  }));

  return { pages: pages.filter((page): page is SearchablePage => page !== null), hits, fetched: missing.length };
}

const compareSlugs = (a: SearchablePage, b: SearchablePage) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** Overlay authorized pages on the public corpus in slug order, the order of
 * the single combined corpus read this replaces (equal-score ties keep it). An
 * overlay page replaces any public copy of the same slug. */
export function overlaySearchPages(publicPages: SearchablePage[], overlay: SearchablePage[]) {
  const overlaySlugs = new Set(overlay.map(page => page.slug));
  return [...publicPages.filter(page => !overlaySlugs.has(page.slug)), ...overlay].sort(compareSlugs);
}
