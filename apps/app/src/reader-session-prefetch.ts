import { createWikiSessionClient, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { readerFetch } from "./reader-telemetry";
import { explicitReaderScope, resolveReaderSession } from "./reader-session";

/** Verify the wiki session for the current URL (cookie-checked by the server). */
export function fetchReaderSession(): Promise<WikiSessionIdentity> {
  const baseUrl = import.meta.env.VITE_WIKI_API_ORIGIN ?? "";
  return resolveReaderSession(
    explicitReaderScope(window.location.search),
    (requestedScope, fallbackToPublic) => createWikiSessionClient({ fetch: readerFetch,
      scope: requestedScope,
      baseUrl,
      credentials: baseUrl ? "include" : "same-origin",
      requestTimeoutMs: 30_000,
    }).fetchSessionIdentity({ fallbackToPublic,
      profileStartup: new URLSearchParams(window.location.search).get("paintDebug") === "1" }),
  );
}

let prefetched: Promise<WikiSessionIdentity> | null = null;

/**
 * Start session verification at the entry, in parallel with the reader chunk
 * download, instead of after WikiViteRoot loads and mounts. Starting it early
 * authorizes nothing: WikiViteRoot still applies all identity checks.
 */
export function prefetchReaderSession() {
  if (prefetched) return;
  const pending = fetchReaderSession();
  // The consumer handles failure; never report an unclaimed prefetch.
  pending.catch(() => {});
  prefetched = pending;
}

/** The prefetched verification once (first mount), otherwise a fresh one. */
export function takeReaderSession(): Promise<WikiSessionIdentity> {
  const pending = prefetched;
  prefetched = null;
  return pending ?? fetchReaderSession();
}
