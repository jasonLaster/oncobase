import { expect, test } from "bun:test";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { ROOT_CONTEXT, SpanKind } from "@opentelemetry/api";
import { parseReaderBatch } from "../shared/reader-telemetry";
import { parseManifestTelemetry } from "../shared/manifest-telemetry";
import { handleReaderTelemetry, boundedJson } from "./reader-telemetry";
import { traceBackendHandler } from "./backend-tracing";
import { safeSampler, redactRequestAttributes } from "./vercel-tracing";

const fixture = () => ({ version: 1, traceId: "abcdef0123456789abcdef0123456789", dropped: 0,
  spans: [{ name: "request-manifest", start: Date.now() - 100, duration: 100, status: 200 }] });

test("browser telemetry reconstructs an allowlist and rejects invalid clocks and unbounded batches", () => {
  const value = { ...fixture(), title: "PRIVATE", spans: [{ ...fixture().spans[0], url: "PRIVATE", error: "PRIVATE", rpcMs: Infinity }] };
  expect(JSON.stringify(parseReaderBatch(value))).not.toContain("PRIVATE");
  expect(parseReaderBatch({ ...value, spans: Array(33).fill(value.spans[0]) })).toBeNull();
  expect(parseReaderBatch({ ...value, spans: [{ ...value.spans[0], name: "PRIVATE" }] })).toBeNull();
  expect(parseReaderBatch({ ...value, spans: [{ ...value.spans[0], start: 0 }] })).toBeNull();
  expect(parseReaderBatch({ ...value, spans: [{ ...value.spans[0], duration: -1 }] })).toBeNull();
});

test("render-error spans keep only their boundary scope and status", () => {
  const span = { name: "render-error-comments", start: Date.now(), duration: 0, status: 500, message: "PRIVATE", stack: "PRIVATE" };
  const parsed = parseReaderBatch({ ...fixture(), spans: [span] });
  expect(parsed?.spans).toEqual([{ name: "render-error-comments", start: span.start, duration: 0, status: 500 }]);
  expect(parseReaderBatch({ ...fixture(), spans: [{ ...span, name: "render-error-PRIVATE" }] })).toBeNull();
});

test("same-origin browser timings become native observation spans with original duration attributes", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const handle = traceBackendHandler(handleReaderTelemetry, { tracer: provider.getTracer("test") });
  const request = (origin: string) => new Request("https://wiki.example/api/wiki/telemetry", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(fixture()) });
  expect((await handle(request("https://attacker.example")))?.status).toBe(403);
  expect(exporter.getFinishedSpans().filter(s => s.name.startsWith("observation.reader."))).toHaveLength(0);
  expect((await handle(request("https://wiki.example")))?.status).toBe(204);
  const spans = exporter.getFinishedSpans();
  const reader = spans.find(s => s.name === "observation.reader.request-manifest")!;
  expect(reader.attributes["measurement.duration_ms"]).toBe(100);
  expect(reader.attributes["oncobase.client.trace_id"]).toBe(fixture().traceId);
  expect(reader.parentSpanContext?.spanId).toBe(spans.at(-1)!.spanContext().spanId);
  await provider.shutdown();
});

test("streaming bodies cannot bypass the telemetry size limit", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(17_000)); controller.close(); } });
  await expect(boundedJson(new Request("https://example.test", { method: "POST", body, duplex: "half" } as RequestInit))).rejects.toThrow("size");
});

test("native SDK records only explicit safe spans and strips SDK request attributes", async () => {
  expect(safeSampler.shouldSample(ROOT_CONTEXT, "0".repeat(32), "ai.generate", SpanKind.INTERNAL, { prompt: "PRIVATE" }, []).decision).toBe(SamplingDecision.NOT_RECORD);
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ sampler: safeSampler, spanProcessors: [redactRequestAttributes, new SimpleSpanProcessor(exporter)] });
  const tracer = provider.getTracer("test");
  tracer.startSpan("ai.generate", { attributes: { prompt: "PRIVATE" } }).end();
  tracer.startSpan("wiki /api/wiki/session", { attributes: { "oncobase.safe": true, "http.referer": "PRIVATE", "http.user_agent": "PRIVATE", "vercel.matched_path": "PRIVATE", "http.route": "/api/wiki/session" } }).end();
  expect(exporter.getFinishedSpans()).toHaveLength(1);
  expect(JSON.stringify(exporter.getFinishedSpans()[0]!.attributes)).not.toContain("PRIVATE");
  await provider.shutdown();
});

test("manifest relay validates enums and exports only fixed numeric phases", () => {
  const event = { version: 1, startedAt: Date.now(), revision: 1, durationMs: 100, incremental: false, outcome: "active-writer", failureStage: "none", phases: { read: 80, PRIVATE: "secret" }, error: "PRIVATE" };
  expect(JSON.stringify(parseManifestTelemetry(event))).not.toContain("PRIVATE");
  expect(parseManifestTelemetry({ ...event, outcome: "PRIVATE error" })).toBeNull();
  expect(parseManifestTelemetry({ ...event, attempt: 2 })?.attempt).toBe(2);
  expect(parseManifestTelemetry({ ...event, attempt: -1 })?.attempt).toBeUndefined();
  expect(parseManifestTelemetry({ ...event, attempt: "PRIVATE" })?.attempt).toBeUndefined();
});

test("browser spans keep validated server timing and trace joins only", async () => {
  const span = { name: "nav-document", start: Date.now() - 100, duration: 100, status: 200, serverMs: 42.5, serverTraceId: "1234567890abcdef1234567890abcdef" };
  expect(parseReaderBatch({ ...fixture(), spans: [span] })!.spans[0]).toMatchObject({ serverMs: 42.5, serverTraceId: span.serverTraceId });
  const invalid = parseReaderBatch({ ...fixture(), spans: [{ ...span, serverMs: -1, serverTraceId: "PRIVATE" }] })!.spans[0]!;
  expect(invalid.serverMs).toBeUndefined();
  expect(invalid.serverTraceId).toBeUndefined();
  expect(parseReaderBatch({ ...fixture(), spans: [{ ...span, serverTraceId: "0".repeat(32) }] })!.spans[0]!.serverTraceId).toBeUndefined();

  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const handle = traceBackendHandler(handleReaderTelemetry, { tracer: provider.getTracer("test") });
  await handle(new Request("https://wiki.example/api/wiki/telemetry", { method: "POST", headers: { origin: "https://wiki.example", "Content-Type": "application/json" },
    body: JSON.stringify({ ...fixture(), spans: [span] }) }));
  const reader = exporter.getFinishedSpans().find(s => s.name === "observation.reader.nav-document")!;
  expect(reader.attributes["server.duration_ms"]).toBe(42.5);
  expect(reader.attributes["oncobase.server.trace_id"]).toBe(span.serverTraceId);
  await provider.shutdown();
});

test("boot spans keep only fixed reasons and bounded numeric resource fields", async () => {
  const span = { name: "resource-worker", start: Date.now() - 100, duration: 80, status: 200, offsetMs: 412.5, bytes: 171_000, count: 1, cached: false, reason: "lock-wait", url: "PRIVATE" };
  const parsed = parseReaderBatch({ ...fixture(), spans: [span] })!.spans[0]!;
  expect(parsed).toEqual({ name: "resource-worker", start: span.start, duration: 80, status: 200, offsetMs: 412.5, bytes: 171_000, count: 1, cached: false, reason: "lock-wait" });
  const invalid = parseReaderBatch({ ...fixture(), spans: [{ ...span, reason: "PRIVATE", offsetMs: -1, bytes: 1.5, count: 1001 }] })!.spans[0]!;
  expect(JSON.stringify(invalid)).not.toContain("PRIVATE");
  expect([invalid.reason, invalid.offsetMs, invalid.bytes, invalid.count]).toEqual([undefined, undefined, undefined, undefined]);
  expect(parseReaderBatch({ ...fixture(), spans: [{ ...span, name: "sync-error", reason: "manifest-http5xx" }] })!.spans[0]!.reason).toBe("manifest-http5xx");

  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const handle = traceBackendHandler(handleReaderTelemetry, { tracer: provider.getTracer("test") });
  await handle(new Request("https://wiki.example/api/wiki/telemetry", { method: "POST", headers: { origin: "https://wiki.example", "Content-Type": "application/json" },
    body: JSON.stringify({ ...fixture(), spans: [span, { name: "store-timeout", start: Date.now() - 10, duration: 3000, status: 500, reason: "worker-boot" }] }) }));
  const resource = exporter.getFinishedSpans().find(s => s.name === "observation.reader.resource-worker")!;
  expect(resource.attributes).toMatchObject({ "reader.offset_ms": 412.5, "reader.transfer_bytes": 171_000, "reader.count": 1, "reader.cached": false });
  expect(exporter.getFinishedSpans().find(s => s.name === "observation.reader.store-timeout")!.attributes["reader.reason"]).toBe("worker-boot");
  await provider.shutdown();
});

test("session handoff spans keep only a fixed outcome and relay it as an attribute", async () => {
  const span = { name: "session-handoff", start: Date.now() - 400, duration: 380, status: 200, offsetMs: 1400, outcome: "kept-mounted", slug: "PRIVATE" };
  expect(parseReaderBatch({ ...fixture(), spans: [span] })!.spans[0]).toEqual({ name: "session-handoff", start: span.start, duration: 380, status: 200, offsetMs: 1400, outcome: "kept-mounted" });
  const invalid = parseReaderBatch({ ...fixture(), spans: [{ ...span, outcome: "PRIVATE" }] })!.spans[0]!;
  expect(invalid.outcome).toBeUndefined();
  expect(JSON.stringify(invalid)).not.toContain("PRIVATE");

  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const handle = traceBackendHandler(handleReaderTelemetry, { tracer: provider.getTracer("test") });
  await handle(new Request("https://wiki.example/api/wiki/telemetry", { method: "POST", headers: { origin: "https://wiki.example", "Content-Type": "application/json" },
    body: JSON.stringify({ ...fixture(), spans: [{ ...span, outcome: "timeout" }] }) }));
  const relayed = exporter.getFinishedSpans().find(s => s.name === "observation.reader.session-handoff")!;
  expect(relayed.attributes).toMatchObject({ "reader.handoff_outcome": "timeout", "reader.offset_ms": 1400 });
  await provider.shutdown();
});
