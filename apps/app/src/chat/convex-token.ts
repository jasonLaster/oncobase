type TokenFetcher = (url: string, options: RequestInit) => Promise<Response>;

export async function fetchWikiConvexToken(fetchToken: TokenFetcher = fetch): Promise<string | null> {
  try {
    const response = await fetchToken("/api/wiki/convex-token", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = await response.json() as { token?: unknown } | null;
    return typeof body?.token === "string" ? body.token : null;
  } catch {
    // Reloading or leaving chat can cancel either the request or body read.
    // Convex expects an unavailable token to resolve to null; a rejected auth
    // callback otherwise escapes refetchToken as an unhandled rejection.
    return null;
  }
}
