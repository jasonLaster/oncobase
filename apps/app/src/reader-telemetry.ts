import { READER_PHASES, type ReaderPhase, type ReaderSpan } from "../shared/reader-telemetry";

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

export function recordReaderPhase(name: string, data?: Record<string, unknown>) {
  const phase = name === "sync" ? `sync-${data?.status}` : name;
  if (!READER_PHASES.includes(phase as ReaderPhase)) return;
  if (performance.now() > 300_000) return;
  enqueue({ name: phase as ReaderPhase, start: performance.timeOrigin, duration: performance.now(), status: phase.endsWith("error") || phase === "store-timeout" ? 500 : 200 });
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
