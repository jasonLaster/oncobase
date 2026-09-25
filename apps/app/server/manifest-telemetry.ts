import { timingSafeEqual } from "node:crypto";
import { parseManifestTelemetry } from "../shared/manifest-telemetry";
import { boundedJson } from "./reader-telemetry";
import { recordRemoteSpan } from "./backend-tracing";

export async function handleManifestTelemetry(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  const expected = process.env.WIKI_PREFETCH_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected || expected.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return new Response(null, { status: 401, headers });
  try {
    const event = parseManifestTelemetry(await boundedJson(request));
    if (!event) return new Response(null, { status: 400, headers });
    const attributes: Record<string, string | number | boolean> = { "telemetry.source": "convex", "manifest.revision": event.revision, "manifest.incremental": event.incremental, "manifest.outcome": event.outcome, "manifest.failure_stage": event.failureStage,
      ...(event.clientTraceId ? { "oncobase.client.trace_id": event.clientTraceId } : {}) };
    for (const [key, duration] of Object.entries(event.phases)) attributes[`manifest.phase.${key}_ms`] = duration;
    recordRemoteSpan("manifest.build", event.startedAt, event.durationMs, attributes, event.outcome === "failed");
    if (event.queuedAt !== undefined) recordRemoteSpan("manifest.queue", event.queuedAt, event.startedAt - event.queuedAt, attributes);
    // Aggregate phase durations are attributes, not fictitious sequential spans:
    // the full builder may overlap reads and increment phases across pages.
    console.info("oncobase.manifest", JSON.stringify(event));
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 400, headers }); }
}
