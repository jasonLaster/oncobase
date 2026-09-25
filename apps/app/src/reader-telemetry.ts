import { READER_PHASES, type ReaderPhase, type ReaderSpan } from "../shared/reader-telemetry";

// Per-page random identity, never persisted or derived from a user or page.
let id: string | undefined;
let queue: ReaderSpan[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let count = 0, dropped = 0;
function traceId() {
  if (!id) {
    id = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    window.addEventListener("pagehide", () => flush(true));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
  }
  return id;
}

function flush(beacon = false) {
  clearTimeout(timer); timer = undefined;
  if (!queue.length) return;
  const payload = JSON.stringify({ version: 1, traceId: traceId(), spans: queue.splice(0, 32), dropped });
  // Failure is deliberately best-effort: no retries or impact on reader work.
  try {
    if (beacon && navigator.sendBeacon?.("/api/wiki/telemetry", new Blob([payload], { type: "application/json" }))) return;
  void fetch("/api/wiki/telemetry", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, signal: AbortSignal.timeout(2000) }).catch(() => {});
  } catch { /* Page teardown and restricted fetch implementations are optional. */ }
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
    const rpc = response.headers.get("Server-Timing")?.match(/convex-rpc;dur=([\d.]+)/);
    enqueue({ name: phase, start, duration: performance.timeOrigin + performance.now() - start, status,
      rpcMs: rpc ? Number(rpc[1]) : undefined,
      partial: response.headers.get("X-Wiki-Manifest-Partial") === "true", cached: status === 304 });
    return response;
  } catch (error) {
    enqueue({ name: phase, start, duration: performance.timeOrigin + performance.now() - start, status: 0 });
    throw error;
  }
}) as typeof fetch;
