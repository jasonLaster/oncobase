import type { WikiScope, WikiSessionIdentity } from "@oncobase/wiki-content";

/** URL overrides are intentional; legacy localStorage values are not auth state. */
export function explicitReaderScope(search: string): WikiScope | null {
  const scope = new URLSearchParams(search).get("scope");
  return scope === "public" || scope === "session" ? scope : null;
}

export async function resolveReaderSession(
  explicitScope: WikiScope | null,
  fetchIdentity: (scope: WikiScope, fallbackToPublic?: boolean) => Promise<WikiSessionIdentity>,
): Promise<WikiSessionIdentity> {
  if (explicitScope) return fetchIdentity(explicitScope);
  try {
    // The server validates the current cookie and returns a user/access-specific
    // cache key. Never infer private access from the previous browser's mode.
    return await fetchIdentity("session", true);
  } catch (error) {
    // Older API deployments may not support the same-response fallback yet.
    // Only an absent/expired session selects public automatically. Outages and
    // authorization failures must not masquerade as missing private pages.
    if (!(error instanceof Error) || !/^Wiki request failed: 401\b/.test(error.message)) {
      throw error;
    }
    return fetchIdentity("public");
  }
}

const IDENTITY_RETRY_BASE_MS = 10_000;
const IDENTITY_RETRY_MAX_MS = 5 * 60_000;

/** Background identity re-verification during an outage: 10 s, 20 s, 40 s … capped at 5 min. */
export function identityRetryDelayMs(failures: number): number {
  return Math.min(IDENTITY_RETRY_MAX_MS, IDENTITY_RETRY_BASE_MS * 2 ** Math.max(0, Math.min(failures, 10)));
}
