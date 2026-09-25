import { parseReaderBatch } from "../shared/reader-telemetry";
import { recordRemoteSpan } from "./backend-tracing";

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
    const batch = parseReaderBatch(await boundedJson(request));
    if (!batch) return new Response(null, { status: 400, headers });
    for (const span of batch.spans) recordRemoteSpan(`reader.${span.name}`, span.start, span.duration, {
      "oncobase.client.trace_id": batch.traceId, "telemetry.source": "browser", "telemetry.clock": "client",
      "http.response.status_code": span.status, ...(span.rpcMs === undefined ? {} : { "convex.rpc_sum_ms": span.rpcMs }),
      ...(span.partial === undefined ? {} : { "manifest.partial": span.partial }), ...(span.cached === undefined ? {} : { "reader.cached": span.cached }),
    }, span.status === 0 || span.status >= 400);
    console.info("oncobase.reader", JSON.stringify(batch));
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 400, headers }); }
}
