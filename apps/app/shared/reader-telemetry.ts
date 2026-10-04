export const READER_PHASES = ["identity-start", "identity-ready", "identity-error", "storage-ready", "reader-live-handoff", "store-existing-leader", "store-new-leader", "store-timeout", "store-boot-enter", "store-boot-complete", "snapshot-dismiss", "reader-ready", "sync-idle", "sync-syncing", "sync-ready", "sync-offline", "sync-error", "request-session", "request-manifest", "request-pages", "request-prefetch",
  // Document request to first byte; LCP; worst interaction; blocking time before LCP.
  "nav-document", "vital-lcp", "vital-inp", "vital-tbt",
  // In-app navigation to rendered body (cached: body already local); search latency.
  "route-render", "search-text", "search-ai",
  // An error boundary caught a render error (scope only; never the message).
  "render-error-root", "render-error-route", "render-error-body", "render-error-comments",
  // Browser boot, as time since navigation: first module evaluated, entry body
  // reached render, first React commit, WikiViteRoot and LiveStoreRoot modules evaluated.
  "boot-script", "boot-entry", "boot-react-commit", "boot-reader-module", "boot-store-module",
  // LiveStore boot observed from app code (no library patches): workers constructed
  // (the dedicated worker only exists once this tab holds the leader lock), the
  // worker script evaluating, the worker's wasm load + OPFS open and a state-db
  // recreate, and the main thread's whole adapter boot through snapshot import
  // (the last three with real durations, from the library's own measures).
  "store-shared-worker-created", "store-worker-created", "store-worker-script", "store-worker-db-open", "store-worker-recreate", "store-adapter",
  // Resource timing per fixed boot category (never URLs): offsetMs = fetch start
  // since navigation, duration = first start to last response end, bytes = transfer size.
  "resource-entry", "resource-reader", "resource-css", "resource-worker", "resource-shared-worker", "resource-wasm",
  // A cached presentation met a different verified identity: duration = wait from
  // identity to the visible store swap, offsetMs = swap since navigation, outcome below.
  "session-handoff"] as const;
export type ReaderPhase = typeof READER_PHASES[number];
/** Fixed failure classes for store-timeout (furthest boot milestone reached) and sync-error (source-kind). */
export const READER_REASONS = ["adapter", "lock-wait", "follower", "worker-boot", "leader-boot", "store-create", "temporary",
  "auth", ...(["manifest", "body"] as const).flatMap(source => (["timeout", "network", "http4xx", "http5xx", "other"] as const).map(kind => `${source}-${kind}` as const))] as const;
export type ReaderReason = typeof READER_REASONS[number];
/** session-handoff outcomes: the public page stayed until the session store held the route,
 * the wait hit its deadline, sync failed first, or the identity change required a remount. */
export const READER_HANDOFF_OUTCOMES = ["kept-mounted", "timeout", "sync-error", "remount-required"] as const;
export type ReaderHandoffOutcome = typeof READER_HANDOFF_OUTCOMES[number];
/** serverMs/serverTraceId come from the response's Server-Timing `app` and `trace` entries. */
export type ReaderSpan = { name: ReaderPhase; start: number; duration: number; status: number; rpcMs?: number; serverMs?: number; serverTraceId?: string; partial?: boolean; cached?: boolean;
  reason?: ReaderReason; outcome?: ReaderHandoffOutcome; offsetMs?: number; bytes?: number; count?: number };
const bounded = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
export type ReaderBatch = { version: 1; traceId: string; spans: ReaderSpan[]; dropped: number };

// Reconstruct a strict allowlist, rather than forwarding arbitrary properties.
export function parseReaderBatch(value: unknown, now = Date.now()): ReaderBatch | null {
  if (!value || typeof value !== "object") return null;
  const body = value as ReaderBatch;
  if (body.version !== 1 || !/^[a-f0-9]{32}$/.test(body.traceId) || /^0+$/.test(body.traceId) || !Array.isArray(body.spans) || body.spans.length > 32 || !body.spans.length) return null;
  const spans: ReaderSpan[] = [];
  for (const item of body.spans) {
    if (!item || !READER_PHASES.includes(item.name) || !Number.isFinite(item.start) || Math.abs(now - item.start) > 600_000 || !Number.isFinite(item.duration) || item.duration < 0 || item.duration > 300_000 || !Number.isInteger(item.status) || item.status < 0 || item.status > 599) return null;
    spans.push({ name: item.name, start: item.start, duration: item.duration, status: item.status,
      ...(typeof item.rpcMs === "number" && Number.isFinite(item.rpcMs) && item.rpcMs >= 0 && item.rpcMs <= 300_000 ? { rpcMs: item.rpcMs } : {}),
      ...(typeof item.serverMs === "number" && Number.isFinite(item.serverMs) && item.serverMs >= 0 && item.serverMs <= 300_000 ? { serverMs: item.serverMs } : {}),
      ...(typeof item.serverTraceId === "string" && /^[a-f0-9]{32}$/.test(item.serverTraceId) && !/^0+$/.test(item.serverTraceId) ? { serverTraceId: item.serverTraceId } : {}),
      ...(typeof item.partial === "boolean" ? { partial: item.partial } : {}),
      ...(typeof item.cached === "boolean" ? { cached: item.cached } : {}),
      ...(READER_REASONS.includes(item.reason as ReaderReason) ? { reason: item.reason } : {}),
      ...(READER_HANDOFF_OUTCOMES.includes(item.outcome as ReaderHandoffOutcome) ? { outcome: item.outcome } : {}),
      ...(bounded(item.offsetMs, 300_000) ? { offsetMs: item.offsetMs } : {}),
      ...(Number.isInteger(item.bytes) && bounded(item.bytes, 1e9) ? { bytes: item.bytes } : {}),
      ...(Number.isInteger(item.count) && bounded(item.count, 1000) ? { count: item.count } : {}),
    });
  }
  return { version: 1, traceId: body.traceId, spans, dropped: Number.isInteger(body.dropped) && body.dropped >= 0 && body.dropped <= 1e6 ? body.dropped : 0 };
}
