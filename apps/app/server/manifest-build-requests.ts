import { waitUntil } from "@vercel/functions";

export const MANIFEST_BUILD_REQUEST_INTERVAL_MS = 10_000;

/**
 * A snapshot miss asks Convex to build one, but the reader must not wait for
 * that mutation: it is served from the live path either way. Requests run in
 * the background (kept alive past the response on Vercel) and are throttled
 * per site and instance, since Convex already coalesces builds under a lease.
 */
export function createManifestBuildRequester({
  intervalMs = MANIFEST_BUILD_REQUEST_INTERVAL_MS,
  now = Date.now,
  background = waitUntil,
  logger = console,
}: {
  intervalMs?: number;
  now?: () => number;
  background?: (promise: Promise<unknown>) => void;
  logger?: Pick<Console, "warn">;
} = {}) {
  const requestedAt = new Map<string, number>();
  return (siteSlug: string, request: () => Promise<unknown>) => {
    const at = now();
    const last = requestedAt.get(siteSlug);
    if (last !== undefined && at - last < intervalMs) return false;
    requestedAt.set(siteSlug, at);
    const pending = Promise.resolve()
      .then(request)
      .catch((error: unknown) => logger.warn("[wiki manifest] Snapshot build request failed", error));
    try { background(pending); } catch { /* Outside a Vercel request the promise simply runs. */ }
    return true;
  };
}
