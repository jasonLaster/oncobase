import type { WikiScope, WikiSessionIdentity } from "@oncobase/wiki-content";

/** URL overrides are intentional; legacy localStorage values are not auth state. */
export function explicitReaderScope(search: string): WikiScope | null {
  const scope = new URLSearchParams(search).get("scope");
  return scope === "public" || scope === "session" ? scope : null;
}

export async function resolveReaderSession(
  explicitScope: WikiScope | null,
  fetchIdentity: (scope: WikiScope) => Promise<WikiSessionIdentity>,
): Promise<WikiSessionIdentity> {
  if (explicitScope) return fetchIdentity(explicitScope);
  try {
    // The server validates the current cookie and returns a user/access-specific
    // cache key. Never infer private access from the previous browser's mode.
    return await fetchIdentity("session");
  } catch (error) {
    // Only an absent/expired session selects public automatically. Outages and
    // authorization failures must not masquerade as missing private pages.
    if (!(error instanceof Error) || !/^Wiki request failed: 401\b/.test(error.message)) {
      throw error;
    }
    return fetchIdentity("public");
  }
}
