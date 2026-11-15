import { expect, test } from "bun:test";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { ROOT_CONTEXT, SpanKind } from "@opentelemetry/api";
import { parseReaderBatch, readReaderBatch, readerRouteType } from "../shared/reader-telemetry";
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

test("vitals sent when a long-open page is first hidden are accepted, and rejections name a fixed class", () => {
  const hoursAgo = (hours: number) => Date.now() - hours * 3_600_000;
  const vital = (start: number) => ({ ...fixture(), spans: [{ name: "vital-lcp", start, duration: 900, status: 200 }] });
  expect(parseReaderBatch(vital(hoursAgo(3)))?.spans).toHaveLength(1);
  expect(readReaderBatch(vital(hoursAgo(25)))).toEqual({ rejected: "span-clock" });
  expect(readReaderBatch(vital(Date.now() + 11 * 60_000))).toEqual({ rejected: "span-clock" });
  expect(readReaderBatch({ ...fixture(), spans: [] })).toEqual({ rejected: "shape" });
  expect(readReaderBatch({ ...fixture(), spans: [{ ...fixture().spans[0], name: "PRIVATE" }] })).toEqual({ rejected: "span-name" });
  expect(readReaderBatch({ ...fixture(), spans: [{ ...fixture().spans[0], duration: -1 }] })).toEqual({ rejected: "span-duration" });
  expect(readReaderBatch({ ...fixture(), spans: [{ ...fixture().spans[0], status: 700 }] })).toEqual({ rejected: "span-status" });
});

test("page context keeps only fixed classes and labels automation", async () => {
  const context = { synthetic: true, viewport: "narrow", input: "touch", cpu: "low", connection: "4g", route: "wiki", startup: "snapshot",
    userAgent: "PRIVATE", url: "PRIVATE" };
  expect(parseReaderBatch({ ...fixture(), context })!.context).toEqual({ synthetic: true, viewport: "narrow", input: "touch", cpu: "low", connection: "4g", route: "wiki", startup: "snapshot" });
  expect(parseReaderBatch({ ...fixture(), context: { viewport: "PRIVATE", route: "/wiki/PRIVATE", synthetic: "yes" } })!.context).toBeUndefined();
  expect(parseReaderBatch(fixture())!.context).toBeUndefined();

  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const handle = traceBackendHandler(handleReaderTelemetry, { tracer: provider.getTracer("test") });
  const post = (body: unknown, headers: Record<string, string> = {}) => handle(new Request("https://wiki.example/api/wiki/telemetry", { method: "POST",
    headers: { origin: "https://wiki.example", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
  expect((await post({ ...fixture(), context }))?.status).toBe(204);
  const labelled = exporter.getFinishedSpans().find(s => s.name === "observation.reader.request-manifest")!;
  expect(labelled.attributes).toMatchObject({ "oncobase.synthetic": true, "reader.viewport": "narrow", "reader.input": "touch", "reader.cpu": "low",
    "reader.connection": "4g", "reader.route_type": "wiki", "reader.startup": "snapshot" });
  expect(JSON.stringify(labelled.attributes)).not.toContain("PRIVATE");
  exporter.reset();
  // A person's browser: no label. The test-run header labels the request and everything recorded under it.
  expect((await post(fixture()))?.status).toBe(204);
  expect(exporter.getFinishedSpans().every(s => s.attributes["oncobase.synthetic"] === undefined)).toBe(true);
  exporter.reset();
  expect((await post(fixture(), { "x-wiki-test-run": "1" }))?.status).toBe(204);
  expect(exporter.getFinishedSpans().map(s => s.attributes["oncobase.synthetic"])).toEqual([true, true]);
  exporter.reset();
  expect((await post({ ...fixture(), spans: [{ ...fixture().spans[0], start: 0 }] }))?.status).toBe(400);
  expect(exporter.getFinishedSpans().at(-1)!.attributes["reader.telemetry.rejected"]).toBe("span-clock");
  await provider.shutdown();
});

test("route families come from the top-level app and first path segment, never a page", () => {
  expect(readerRouteType("reader", "/wiki/treatment/PRIVATE")).toBe("wiki");
  expect(readerRouteType("reader", "/sources/PRIVATE")).toBe("wiki");
  expect(readerRouteType("reader", "/")).toBe("wiki");
  expect(readerRouteType("reader", "/search")).toBe("search");
  expect(readerRouteType("reader", "/admin/roles")).toBe("admin");
  expect(readerRouteType("reader", "/tags/PRIVATE")).toBe("tags");
  expect(readerRouteType("login", "/")).toBe("landing");
  expect(readerRouteType("login", "/login")).toBe("sign-in");
  expect(readerRouteType("dicom", "/tools/dicom-viewer")).toBe("tools");
  expect(readerRouteType("education", "/education/PRIVATE")).toBe("education");
  expect(readerRouteType("oncobase-home", "/")).toBe("other");
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

test("store boot spans keep only the fixed snapshot path enum and relay it", async () => {
  const span = { name: "store-adapter", start: Date.now() - 100, duration: 42, status: 200, offsetMs: 300, path: "fallback-changed" };
  expect(parseReaderBatch({ ...fixture(), spans: [span] })!.spans[0]!.path).toBe("fallback-changed");
  for (const path of ["PRIVATE", 1, null, "Fast"]) {
    const parsed = parseReaderBatch({ ...fixture(), spans: [{ ...span, path }] })!.spans[0]!;
    expect(parsed.path).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE");
  }
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const handle = traceBackendHandler(handleReaderTelemetry, { tracer: provider.getTracer("test") });
  await handle(new Request("https://wiki.example/api/wiki/telemetry", { method: "POST", headers: { origin: "https://wiki.example", "Content-Type": "application/json" },
    body: JSON.stringify({ ...fixture(), spans: [span, { name: "store-fast-path", start: Date.now() - 10, duration: 3, status: 200, offsetMs: 120, path: "fast" }] }) }));
  const finished = exporter.getFinishedSpans();
  expect(finished.find(s => s.name === "observation.reader.store-adapter")!.attributes["reader.store_path"]).toBe("fallback-changed");
  expect(finished.find(s => s.name === "observation.reader.store-fast-path")!.attributes["reader.store_path"]).toBe("fast");
  expect(finished.find(s => s.name === "observation.reader.request-manifest")).toBeUndefined();
  await provider.shutdown();
});
