import { READER_PHASES, READER_REASONS, type ReaderHandoffOutcome, type ReaderPhase, type ReaderReason, type ReaderSpan } from "../shared/reader-telemetry";
import { storeBootPath } from "./livestore/store-boot-path";

// Per-page random identity, never persisted or derived from a user or page.
let id: string | undefined;
let queue: ReaderSpan[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let count = 0, dropped = 0;
// Vitals finalize when the page is first hidden, just before the beacon.
const finalizers: Array<() => void> = [];
function traceId() {
  if (!id) {
    id = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    window.addEventListener("pagehide", () => flush(true));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
  }
  return id;
}

function flush(beacon = false) {
  if (beacon) for (const finalize of finalizers.splice(0)) { try { finalize(); } catch { /* Optional. */ } }
  clearTimeout(timer); timer = undefined;
  // The page may not run again after hide: drain every batch, not only the first.
  do {
    if (!queue.length) return;
    const payload = JSON.stringify({ version: 1, traceId: traceId(), spans: queue.splice(0, 32), dropped });
    // Failure is deliberately best-effort: no retries or impact on reader work.
    try {
      if (beacon && navigator.sendBeacon?.("/api/wiki/telemetry", new Blob([payload], { type: "application/json" }))) continue;
      void fetch("/api/wiki/telemetry", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, signal: AbortSignal.timeout(2000) }).catch(() => {});
    } catch { /* Page teardown and restricted fetch implementations are optional. */ }
  } while (beacon);
  if (queue.length) timer = setTimeout(() => flush(), 2000);
}

function enqueue(span: ReaderSpan) {
  if (typeof window === "undefined" || import.meta.env.MODE === "test") return;
  try {
    traceId();
    if (count++ >= 256) { dropped++; return; }
    queue.push(span);
    if (queue.length >= 32) flush();
    else timer ??= setTimeout(() => flush(), 2000);
  } catch { /* Diagnostics cannot break reading, even in restricted browsers. */ }
}

/** A lifecycle mark: time since navigation (or `at`, an earlier performance.now()). */
export function recordReaderPhase(name: string, data?: Record<string, unknown>, at = performance.now()) {
  const phase = name === "sync" ? `sync-${data?.status}` : name;
  if (!READER_PHASES.includes(phase as ReaderPhase)) return;
  if (at > 300_000 || at < 0) return;
  const reason = READER_REASONS.includes(data?.reason as ReaderReason) ? data!.reason as ReaderReason : undefined;
  // The store's snapshot path (fast, leader, guard fallback, memory) splits boot timings.
  const path = phase === "store-boot-complete" ? storeBootPath() : undefined;
  enqueue({ name: phase as ReaderPhase, start: performance.timeOrigin, duration: at, status: phase.endsWith("error") || phase === "store-timeout" ? 500 : 200,
    ...(reason ? { reason } : {}), ...(path ? { path } : {}) });
  // Resource timing is complete once the store booted (or gave up).
  if (phase === "store-boot-complete" || phase === "store-timeout") setTimeout(recordBootResources, 0);
}

/** Fixed sync failure class: source plus HTTP class, timeout, network or other. Never the message. */
export function syncErrorReason(source: "manifest" | "body", error: unknown): ReaderReason {
  const message = error instanceof Error ? error.message : "";
  const status = /^Wiki request failed: (\d)\d\d\b/.exec(message)?.[1];
  const kind = status === "4" ? "http4xx" : status === "5" ? "http5xx"
    : /timed out/.test(message) || (error instanceof Error && error.name === "TimeoutError") ? "timeout"
      : error instanceof TypeError ? "network" : "other";
  return `${source}-${kind}`;
}

/** A boot sub-span with a real duration, starting `offsetMs` after navigation. */
export function recordReaderSpan(name: "store-worker-db-open" | "store-worker-recreate" | "store-adapter" | "store-fast-path", offsetMs: number, duration: number) {
  if (typeof window === "undefined" || !Number.isFinite(offsetMs) || offsetMs < 0 || offsetMs > 300_000 || !Number.isFinite(duration) || duration < 0) return;
  const path = name === "store-adapter" || name === "store-fast-path" ? storeBootPath() : undefined;
  enqueue({ name, start: performance.timeOrigin + offsetMs, duration, status: 200, offsetMs, ...(path ? { path } : {}) });
}

// Entry-graph URLs as the HTML declared them, captured before any lazy preload.
let entryUrls: Set<string> | undefined;
function captureEntryUrls() {
  entryUrls ??= new Set([...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[type="module"][src], link[rel="modulepreload"]:not([data-reader])')]
    .map(node => "src" in node ? node.src : node.href));
}
type ResourceCategory = "entry" | "reader" | "css" | "worker" | "shared-worker" | "wasm";
function resourceCategory(entry: PerformanceResourceTiming, reader: Set<string>): ResourceCategory | null {
  const url = entry.name.split(/[?#]/)[0]!;
  if (/\.wasm$/.test(url) && /sqlite/.test(url)) return "wasm";
  if (/shared-worker/.test(url)) return "shared-worker";
  if (/livestore\.worker/.test(url)) return "worker";
  if (/\.css$/.test(url)) return "css";
  if (reader.has(entry.name)) return "reader";
  if (entryUrls?.has(entry.name)) return "entry";
  return null;
}
let resourcesRecorded = false;
/** One span per fixed boot category: never a URL, only start, span, bytes and cache state. */
export function recordBootResources() {
  if (resourcesRecorded || typeof window === "undefined" || typeof performance.getEntriesByType !== "function") return;
  resourcesRecorded = true;
  try {
    const reader = new Set([...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"][data-reader]')].map(link => link.href));
    const groups = new Map<ResourceCategory, PerformanceResourceTiming[]>();
    for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
      const category = resourceCategory(entry, reader);
      if (category) groups.set(category, [...groups.get(category) ?? [], entry]);
    }
    for (const [category, entries] of groups) {
      const offsetMs = Math.min(...entries.map(entry => entry.startTime));
      const end = Math.max(...entries.map(entry => entry.responseEnd || entry.startTime + entry.duration));
      if (offsetMs > 300_000) continue;
      enqueue({ name: `resource-${category}`, start: performance.timeOrigin + offsetMs, duration: Math.max(0, end - offsetMs), status: 200, offsetMs,
        bytes: Math.round(entries.reduce((sum, entry) => sum + (entry.transferSize || 0), 0)), count: entries.length,
        // Zero transfer with a decoded body: served from the HTTP/memory cache.
        cached: entries.every(entry => entry.transferSize === 0 && entry.decodedBodySize > 0) });
    }
  } catch { /* Resource timing is optional. */ }
}

/** Passed only to the reader content client; no global fetch patching. */
export const readerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(typeof input === "string" ? new URL(input, window.location.origin) : input, init);
  const url = new URL(request.url);
  const phase = ({ "/api/wiki/session": "request-session", "/api/wiki/manifest": "request-manifest", "/api/wiki/pages": "request-pages", "/api/wiki/prefetch": "request-prefetch" } as const)[url.pathname as "/api/wiki/session"];
  if (!phase || url.origin !== window.location.origin) return fetch(request);
  try { request.headers.set("X-Wiki-Reader-Trace", traceId()); } catch { /* Optional correlation. */ }
  const start = performance.timeOrigin + performance.now();
  let status = 0;
  try {
    const response = await fetch(request);
    status = response.status;
    // Fetch spans end at headers; body parsing/commit is covered by sync marks.
    const timing = response.headers.get("Server-Timing");
    const rpc = timing?.match(/convex-rpc;dur=([\d.]+)/);
    enqueue({ name: phase, start, duration: performance.timeOrigin + performance.now() - start, status,
      rpcMs: rpc ? Number(rpc[1]) : undefined, ...serverTiming(timing),
      partial: response.headers.get("X-Wiki-Manifest-Partial") === "true", cached: status === 304 });
    return response;
  } catch (error) {
    enqueue({ name: phase, start, duration: performance.timeOrigin + performance.now() - start, status: 0 });
    throw error;
  }
}) as typeof fetch;

function serverTiming(header: string | null | undefined): Pick<ReaderSpan, "serverMs" | "serverTraceId"> {
  const app = header?.match(/(?:^|,)\s*app;dur=([\d.]+)/);
  const trace = header?.match(/(?:^|,)\s*trace;desc="?([a-f0-9]{32})"?/);
  return { ...(app ? { serverMs: Number(app[1]) } : {}), ...(trace ? { serverTraceId: trace[1] } : {}) };
}

/** A client measurement that just finished (in-app route render, search). */
export function recordReaderDuration(name: "route-render" | "search-text" | "search-ai", duration: number, data: { status?: number; cached?: boolean } = {}) {
  if (typeof window === "undefined" || !Number.isFinite(duration) || duration < 0) return;
  enqueue({ name, start: performance.timeOrigin + performance.now() - duration, duration, status: data.status ?? 200,
    ...(data.cached === undefined ? {} : { cached: data.cached }) });
}

/** How a cached presentation met a different verified identity. `startedAt`/`endedAt`
 * are performance.now() values: identity verified, then the visible store swap. */
export function recordSessionHandoff(outcome: ReaderHandoffOutcome, startedAt: number, endedAt = performance.now()) {
  if (typeof window === "undefined" || !Number.isFinite(startedAt) || startedAt < 0 || endedAt < startedAt || endedAt > 300_000) return;
  enqueue({ name: "session-handoff", start: performance.timeOrigin + startedAt, duration: endedAt - startedAt, status: 200, offsetMs: endedAt, outcome });
}

export type RenderErrorBoundary = "root" | "route" | "body" | "comments";

/** Count a caught render error by boundary scope. Never forwards the error or its message. */
export function recordRenderError(boundary: RenderErrorBoundary) {
  if (typeof window === "undefined") return;
  enqueue({ name: `render-error-${boundary}`, start: performance.timeOrigin + performance.now(), duration: 0, status: 500 });
}

function observe(type: string, callback: (entries: PerformanceEntryList) => void, options: Record<string, unknown> = {}) {
  if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return undefined;
  const observer = new PerformanceObserver(list => callback(list.getEntries()));
  observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
  return observer;
}

/**
 * Document TTFB (joined to the HTML server span via Server-Timing), LCP, worst
 * interaction latency and long-task blocking time. Passive buffered observers;
 * numbers only, never URLs or element identities.
 */
export function observeReaderVitals() {
  if (typeof window === "undefined" || import.meta.env.MODE === "test" || typeof PerformanceObserver === "undefined") return;
  try {
    traceId();
    captureEntryUrls();
    finalizers.push(recordBootResources);
    const navigation = performance.getEntriesByType("navigation")[0] as (PerformanceNavigationTiming & { responseStatus?: number }) | undefined;
    if (navigation && navigation.responseStart > 0) {
      const app = navigation.serverTiming?.find(entry => entry.name === "app");
      const trace = navigation.serverTiming?.find(entry => entry.name === "trace")?.description;
      enqueue({ name: "nav-document", start: performance.timeOrigin + navigation.startTime, duration: navigation.responseStart - navigation.startTime,
        status: navigation.responseStatus || 200,
        // No transfer with a decoded body: HTTP cache or back/forward cache.
        cached: navigation.transferSize === 0 && navigation.decodedBodySize > 0,
        ...(app ? { serverMs: app.duration } : {}), ...(trace && /^[a-f0-9]{32}$/.test(trace) ? { serverTraceId: trace } : {}) });
    }
    let lcp = 0, blocking = 0, lcpDone = false;
    const lcpObserver = observe("largest-contentful-paint", entries => { lcp = entries.at(-1)?.startTime ?? lcp; });
    const longTasks = observe("longtask", entries => { for (const entry of entries) blocking += Math.max(0, entry.duration - 50); });
    // The browser stops reporting LCP candidates at the first input.
    const finishLcp = () => {
      if (lcpDone) return;
      lcpDone = true;
      lcpObserver?.disconnect(); longTasks?.disconnect();
      if (lcp <= 0) return;
      enqueue({ name: "vital-lcp", start: performance.timeOrigin, duration: lcp, status: 200 });
      enqueue({ name: "vital-tbt", start: performance.timeOrigin, duration: blocking, status: 200 });
    };
    for (const type of ["pointerdown", "keydown"]) addEventListener(type, finishLcp, { once: true, capture: true });
    finalizers.push(finishLcp);
    // Worst interaction equals INP below 50 interactions, typical for a reader.
    let worst: { start: number; duration: number } | undefined;
    observe("event", entries => {
      for (const entry of entries as Array<PerformanceEventTiming & { interactionId?: number }>) {
        if (entry.interactionId && (!worst || entry.duration > worst.duration)) worst = { start: entry.startTime, duration: entry.duration };
      }
    }, { durationThreshold: 40 });
    finalizers.push(() => { if (worst) enqueue({ name: "vital-inp", start: performance.timeOrigin + worst.start, duration: worst.duration, status: 200 }); });
  } catch { /* Observers are optional diagnostics. */ }
}
