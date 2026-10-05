/**
 * Memoizes the chat system prompt per site. Phase 7 of the
 * chat-performance plan, plus multi-tenant scoping.
 *
 * The prompt is built from per-site index + diagnosis docs, so the
 * cache key includes the site slug. Without per-site keying, the
 * first site to warm the cache would serve its prompt to every
 * other site for the next 60 seconds.
 */

const TTL_MS = Number(process.env.CHAT_SYSTEM_PROMPT_TTL_MS ?? 60_000);

interface CacheEntry {
  prompt: unknown;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Returns the cached prompt for `siteSlug` if fresh; otherwise calls
 * `loader` exactly once and caches its result. Concurrent callers
 * for the same site share a single in-flight promise.
 */
export async function getCachedSystemPrompt<T = string>(
  siteSlug: string,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(siteSlug);
  if (hit && now - hit.ts < TTL_MS) {
    return hit.prompt as T;
  }
  const existing = inFlight.get(siteSlug);
  if (existing) return existing as Promise<T>;
  const promise = (async () => {
    try {
      const prompt = await loader();
      cache.set(siteSlug, { prompt, ts: Date.now() });
      return prompt;
    } finally {
      inFlight.delete(siteSlug);
    }
  })();
  inFlight.set(siteSlug, promise);
  return promise;
}

/** Test / debug only. */
export function _resetSystemPromptCache(): void {
  cache.clear();
  inFlight.clear();
}
