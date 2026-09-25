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
});
