import { createWikiSessionClient, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { readerFetch } from "./reader-telemetry";
import { explicitReaderScope, resolveReaderSession } from "./reader-session";
import { BOOTSTRAP_MAX_AGE_MS, PAGE_BOOTSTRAP_ID, parseSessionPageBootstrap } from "./bootstrap/page-payload";

/**
 * The session API's answer for this document's own request, when the shell
 * inlined it beside a signed-in page (private, no-store, at most a minute
 * old). It is the same response the reader would fetch, for the same cookies,
 * so the first verification uses it instead of asking again. An explicit
 * public scope, a disabled bootstrap, or any mismatch asks the network.
 */
export function sessionIdentityFromDocument(now = Date.now()): WikiSessionIdentity | null {
  try {
    const search = new URLSearchParams(location.search);
    if (explicitReaderScope(location.search) === "public" || search.get("readerBootstrap") === "0") return null;
    const node = document.getElementById(PAGE_BOOTSTRAP_ID);
    const age = now - Number(node?.dataset.receivedAt);
    if (!node || !Number.isFinite(age) || age < 0 || age > BOOTSTRAP_MAX_AGE_MS) return null;
    const apiOrigin = new URL(import.meta.env.VITE_WIKI_API_ORIGIN || location.origin, location.origin).origin;
    const payload = parseSessionPageBootstrap(node.textContent ?? "", { origin: location.origin, pathname: location.pathname, apiOrigin });
    const configured = import.meta.env.VITE_WIKI_SITE_SLUG?.trim();
    return payload && (!configured || configured === payload.siteSlug) ? payload.identity : null;
  } catch { return null; }
}

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
  const inline = sessionIdentityFromDocument();
  const pending = inline ? Promise.resolve(inline) : fetchReaderSession();
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
