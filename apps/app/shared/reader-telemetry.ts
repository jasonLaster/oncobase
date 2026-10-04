export const READER_PHASES = ["identity-start", "identity-ready", "identity-error", "storage-ready", "reader-live-handoff", "store-existing-leader", "store-new-leader", "store-timeout", "store-boot-enter", "store-boot-complete", "snapshot-dismiss", "reader-ready", "sync-idle", "sync-syncing", "sync-ready", "sync-offline", "sync-error", "request-session", "request-manifest", "request-pages", "request-prefetch",
  // Document request to first byte; LCP; worst interaction; blocking time before LCP.
  "nav-document", "vital-lcp", "vital-inp", "vital-tbt",
  // In-app navigation to rendered body (cached: body already local); search latency.
  "route-render", "search-text", "search-ai",
  // An error boundary caught a render error (scope only; never the message).
  "render-error-root", "render-error-route", "render-error-body", "render-error-comments"] as const;
export type ReaderPhase = typeof READER_PHASES[number];
/** serverMs/serverTraceId come from the response's Server-Timing `app` and `trace` entries. */
export type ReaderSpan = { name: ReaderPhase; start: number; duration: number; status: number; rpcMs?: number; serverMs?: number; serverTraceId?: string; partial?: boolean; cached?: boolean };
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
    });
  }
  return { version: 1, traceId: body.traceId, spans, dropped: Number.isInteger(body.dropped) && body.dropped >= 0 && body.dropped <= 1e6 ? body.dropped : 0 };
}
