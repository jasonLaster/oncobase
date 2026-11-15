/**
 * Content first: the document's head script (scripts/reader-preload-plugin.ts)
 * starts the reader's first requests while the JavaScript downloads, and the
 * reader picks them up here instead of asking again.
 *
 * Starting a request early authorizes nothing. Each early request is the same
 * credentialed GET the reader would send itself, and its response is used only
 * by the client call that would otherwise have made it (matched by URL), so
 * every identity, scope and freshness check still applies to it.
 */

export type EarlyRequests = {
  /** GET responses by same-origin path + query, taken at most once. */
  responses: Record<string, Promise<Response> | undefined>;
  /** performance.now() when each response was requested. */
  startedAt: Record<string, number>;
  /** SQLite wasm and worker scripts, fetched into the HTTP cache. */
  runtime: Promise<unknown>[];
  runtimeUrls: string[];
  /** Starts the runtime downloads, once. Called when the paint-critical
   * modules have arrived (or by the store itself, whichever is first). */
  startRuntime: () => void;
};

export type EarlyRequestConfig = {
  /** Store runtime files: the wasm and the worker scripts. */
  runtime: string[];
};

declare global {
  interface Window { __WIKI_EARLY__?: EarlyRequests }
}

/**
 * Inlined into the document head by source (see reader-preload-plugin.ts), so
 * it must be self-contained and must not reference anything outside itself.
 * Runs only for documents the server routed to the reader.
 */
export function startEarlyRequests(config: EarlyRequestConfig) {
  if (window.__WIKI_EARLY__) return;
  const search = new URLSearchParams(location.search);
  // Controlled comparisons and diagnostics keep the previous request order.
  if (search.get("readerEarly") === "0" || search.get("readerBootstrap") === "0") return;
  let runtimeStarted = false;
  const early: EarlyRequests = { responses: {}, startedAt: {}, runtime: [], runtimeUrls: config.runtime, startRuntime: () => {
    if (runtimeStarted) return;
    runtimeStarted = true;
    // Into the HTTP cache at low priority. Worker construction reads them
    // from cache, and the adapter no longer waits for wasm before workers.
    for (const url of config.runtime) {
      const init: RequestInit & { priority?: string } = { credentials: "same-origin", priority: "low" };
      const pending = fetch(url, init).then(response => response.ok ? response.arrayBuffer() : null);
      pending.catch(() => {});
      early.runtime.push(pending);
    }
  } };
  window.__WIKI_EARLY__ = early;
  const get = (url: string, priority: "high" | "low" | "auto") => {
    const init: RequestInit & { priority?: string } = { credentials: "same-origin", cache: "no-cache",
      headers: { Accept: "application/json" }, priority };
    const pending = fetch(url, init);
    pending.catch(() => {});
    early.responses[url] = pending;
    early.startedAt[url] = performance.now();
    return pending;
  };
  const scopeParam = search.get("scope");
  const explicit = scopeParam === "public" || scopeParam === "session" ? scopeParam : null;
  // What the server already put in this document (app-shell.ts): "session"
  // carries the session API's answer, so the reader does not ask again.
  const root = document.documentElement;
  const payload = root.getAttribute("data-reader-payload");
  // Identical to fetchReaderSession(): automatic scope asks for the session
  // and accepts the server's public answer for a visitor without one. The
  // manifest is not requested here: the tree paints from the document's
  // navigation slice, and the reader asks for the manifest after first paint.
  const session = payload === "session" && explicit !== "public" ? null
    : get(`/api/wiki/session?scope=${explicit ?? "session"}${explicit ? "" : "&fallback=public"}`, "high");
  // The current page, when the document did not inline it.
  // The same slug WikiSync asks for (slugFromPath, contentSlugFromRouteSlug).
  let decoded: string | null = null;
  try { decoded = decodeURIComponent(location.pathname); } catch { /* A malformed path: the reader asks itself. */ }
  if (session && payload === "none" && decoded !== null) {
    decoded = decoded.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.(?:md|mdx)$/i, "");
    const routeSlug = decoded || "index";
    const slug = routeSlug.toLowerCase() === "about/index" ? "index" : routeSlug;
    session.then(response => response.ok ? response.clone().json() : null).then((identity: { scope?: unknown } | null) => {
      const scope = identity?.scope;
      if (scope !== "public" && scope !== "session") return;
      const params = new URLSearchParams({ scope, slugs: slug });
      void get(`/api/wiki/pages?${params}`, "high");
    }).catch(() => {});
  }
}

/** An early answer is as fresh as the document; later reads ask again. */
export const EARLY_RESPONSE_MAX_AGE_MS = 60_000;

/** The early response for exactly this GET, once, with when it was requested. */
export function takeEarlyResponse(url: URL | string): { response: Promise<Response>; startedAt: number } | undefined {
  try {
    const early = typeof window === "undefined" ? undefined : window.__WIKI_EARLY__;
    if (!early) return undefined;
    const parsed = new URL(url, location.origin);
    if (parsed.origin !== location.origin) return undefined;
    const key = `${parsed.pathname}${parsed.search}`;
    const pending = early.responses[key];
    if (!pending) return undefined;
    delete early.responses[key];
    const startedAt = early.startedAt[key] ?? 0;
    return performance.now() - startedAt <= EARLY_RESPONSE_MAX_AGE_MS ? { response: pending, startedAt } : undefined;
  } catch {
    return undefined;
  }
}

/** Drop unclaimed early responses: an identity change must ask again. */
export function discardEarlyResponses() {
  try { if (window.__WIKI_EARLY__) window.__WIKI_EARLY__.responses = {}; } catch { /* Optional. */ }
}

/** Start a reader GET now (once) for a client call that will follow shortly. */
export function startEarlyRead(url: string, priority: "high" | "low" | "auto" = "auto") {
  try {
    const early = window.__WIKI_EARLY__;
    if (!early || early.responses[url]) return;
    const init: RequestInit & { priority?: string } = { credentials: "same-origin", cache: "no-cache",
      headers: { Accept: "application/json" }, priority };
    const pending = fetch(url, init);
    pending.catch(() => {});
    early.responses[url] = pending;
    early.startedAt[url] = performance.now();
  } catch { /* The client asks itself. */ }
}
