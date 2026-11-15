import { readReaderBatch } from "../shared/reader-telemetry";
import { recordRemoteSpan, SYNTHETIC_ATTRIBUTE, traceBackendAttributes } from "./backend-tracing";

export async function boundedJson(request: Request, limit = 16_384): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit || !request.body) throw new Error("Invalid telemetry size");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) { await reader.cancel(); throw new Error("Invalid telemetry size"); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

let tokens = 120, lastRefill = Date.now();
function admitBatch() {
  const now = Date.now();
  tokens = Math.min(120, tokens + (now - lastRefill) / 500);
  lastRefill = now;
  if (tokens < 1) return false;
  tokens--;
  return true;
}
export async function handleReaderTelemetry(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  // This endpoint accepts anonymous browser timings, never trusted business
  // events. Reject cross-origin posts and bound work independently of clients.
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 403, headers });
  if (process.env.WIKI_BACKEND_TRACING === "0") return new Response(null, { status: 204, headers });
  if (!admitBatch()) return new Response(null, { status: 429, headers });
  try {
    const result = readReaderBatch(await boundedJson(request));
    if ("rejected" in result) {
      // A fixed class on the request span: why a batch was refused, never its content.
      traceBackendAttributes({ "reader.telemetry.rejected": result.rejected });
      return new Response(null, { status: 400, headers });
    }
    const { batch } = result;
    const context = batch.context ?? {};
    // Page-level classes repeat on every span so one filter splits any percentile.
    const page = {
      ...(context.synthetic ? { [SYNTHETIC_ATTRIBUTE]: true } : {}),
      ...(context.viewport ? { "reader.viewport": context.viewport } : {}), ...(context.input ? { "reader.input": context.input } : {}),
      ...(context.cpu ? { "reader.cpu": context.cpu } : {}), ...(context.connection ? { "reader.connection": context.connection } : {}),
      ...(context.route ? { "reader.route_type": context.route } : {}), ...(context.startup ? { "reader.startup": context.startup } : {}),
    };
    if (batch.dropped > 0) traceBackendAttributes({ "reader.telemetry.dropped": batch.dropped });
    for (const span of batch.spans) recordRemoteSpan(`reader.${span.name}`, span.start, span.duration, {
      ...page, "oncobase.client.trace_id": batch.traceId, "telemetry.source": "browser", "telemetry.clock": "client",
      "http.response.status_code": span.status, ...(span.rpcMs === undefined ? {} : { "convex.rpc_sum_ms": span.rpcMs }),
      // Client duration minus serverMs is network, CDN and platform overhead.
      ...(span.serverMs === undefined ? {} : { "server.duration_ms": span.serverMs }),
      ...(span.serverTraceId === undefined ? {} : { "oncobase.server.trace_id": span.serverTraceId }),
      ...(span.partial === undefined ? {} : { "manifest.partial": span.partial }), ...(span.cached === undefined ? {} : { "reader.cached": span.cached }),
      ...(span.reason === undefined ? {} : { "reader.reason": span.reason }),
      ...(span.outcome === undefined ? {} : { "reader.handoff_outcome": span.outcome }),
      // Store boot: initial SQLite image via the guarded fast path, the leader, or a fallback.
      ...(span.path === undefined ? {} : { "reader.store_path": span.path }),
      ...(span.tool === undefined ? {} : { "reader.webmcp_tool": span.tool }),
      // Boot spans: start since navigation (client clock), transfer bytes, resource count.
      ...(span.offsetMs === undefined ? {} : { "reader.offset_ms": span.offsetMs }),
      ...(span.bytes === undefined ? {} : { "reader.transfer_bytes": span.bytes }), ...(span.count === undefined ? {} : { "reader.count": span.count }),
    }, span.status === 0 || span.status >= 400);
    console.info("oncobase.reader", JSON.stringify(batch));
    return new Response(null, { status: 204, headers });
  } catch {
    traceBackendAttributes({ "reader.telemetry.rejected": "body" });
    return new Response(null, { status: 400, headers });
  }
}
