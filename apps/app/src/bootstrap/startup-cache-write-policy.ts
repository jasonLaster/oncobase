// The startup snapshot is rebuilt from LiveStore queries, which change on
// every manifest validation (every 30–60 s) even when nothing visible did.
// Rebuilding means stringify + gzip + base64 + a ~2 MB synchronous
// localStorage write, so only write when its content would change.

/** Rewrite an unchanged snapshot at most this often, to keep its validatedAt fresh. */
export const STARTUP_CACHE_REFRESH_MS = 60 * 60 * 1000;

export type StartupCacheWriteInputs = {
  cacheKey: string;
  epoch: string | null;
  manifestHash: string;
  pathname: string;
  page: { contentHash: string | null; contentStatus: string; hasContent: boolean; unavailable: boolean } | null;
};

export function startupCacheWriteKey(inputs: StartupCacheWriteInputs) {
  const { page } = inputs;
  return JSON.stringify([inputs.cacheKey, inputs.epoch, inputs.manifestHash, inputs.pathname,
    page ? [page.contentHash, page.contentStatus, page.hasContent, page.unavailable] : null]);
}

export type LastStartupCacheWrite = { key: string; validatedAt: number } | null;

export function shouldWriteStartupCache(last: LastStartupCacheWrite, key: string, validatedAt: number) {
  return !last || last.key !== key || validatedAt - last.validatedAt >= STARTUP_CACHE_REFRESH_MS;
}

/** Run when the main thread is idle (bounded), falling back to a short timeout. */
export function scheduleIdle(callback: () => void, timeoutMs = 2_000): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(callback, 200);
  return () => window.clearTimeout(timer);
}
