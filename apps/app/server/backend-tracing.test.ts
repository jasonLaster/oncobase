import { expect, test } from "bun:test";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { makeFunctionReference } from "convex/server";
import { traceBackendHandler, traceConvexClient, type BackendProfile } from "./backend-tracing";

const ref = makeFunctionReference<"query">("documents:listManifestPage");

test("overlapping requests retain parentage and expose no arguments or error messages", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const tracer = provider.getTracer("test");
  const profiles: BackendProfile[] = [];
  const client = traceConvexClient({
    async query(_ref: unknown, args: { fail?: boolean }) {
      await Bun.sleep(args.fail ? 1 : 10);
      if (args.fail) throw new Error("PRIVATE error with a patient identifier");
      return "PRIVATE response";
    },
  } as never, tracer);
  const handler = traceBackendHandler(async (request) => {
    await client.query(ref, { fail: request.method === "POST", content: "PRIVATE args" });
    return new Response("PRIVATE body");
  }, { tracer, onProfile: (profile) => profiles.push(profile) });
  const results = await Promise.allSettled([
    handler(new Request("https://example.test/api/wiki/manifest?q=PRIVATE", { headers: { Cookie: "PRIVATE cookie" } })),
    handler(new Request("https://example.test/api/admin/pii/PRIVATE", { method: "POST" })),
  ]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(4);
  const roots = spans.filter((span) => !span.parentSpanContext);
  expect(roots).toHaveLength(2);
  for (const root of roots) {
    const children = spans.filter((span) => span.parentSpanContext?.spanId === root.spanContext().spanId);
    expect(children).toHaveLength(1);
    expect(children[0]!.spanContext().traceId).toBe(root.spanContext().traceId);
    expect(children[0]!.status.code).toBe(root.status.code);
  }
  expect(JSON.stringify(spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })))).not.toContain("PRIVATE");
  expect(profiles.every((profile) => profile.calls.length === 1)).toBe(true);
  expect(profiles.map((profile) => profile.status).sort()).toEqual([200, 500]);
  await provider.shutdown();
});

test("timing preserves existing headers and observers cannot break responses", async () => {
  const previous = process.env.WIKI_BACKEND_TIMING;
  process.env.WIKI_BACKEND_TIMING = "1";
  try {
    const handler = traceBackendHandler(async () => new Response("ok", { headers: { "Server-Timing": "wiki-search;dur=2", "Cache-Control": "private, no-store" } }), {
      onProfile() { throw new Error("observer failure"); },
    });
    const response = await handler(new Request("https://example.test/api/search?q=secret"));
    expect(response!.headers.get("server-timing")).toContain("wiki-search;dur=2, backend;dur=");
    expect(response!.headers.get("cache-control")).toBe("private, no-store");
  } finally {
    if (previous === undefined) delete process.env.WIKI_BACKEND_TIMING;
    else process.env.WIKI_BACKEND_TIMING = previous;
  }
});

test("opt-in tracing exports real OTLP HTTP spans to a collector", async () => {
  const keys = ["WIKI_BACKEND_TRACING", "WIKI_BACKEND_TRACE_SAMPLE_RATE", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] as const;
  const previous = keys.map((key) => process.env[key]);
  const payloads: string[] = [];
  const collector = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      payloads.push(await request.text());
      return Response.json({});
    },
  });
  try {
    process.env.WIKI_BACKEND_TRACING = "1";
    process.env.WIKI_BACKEND_TRACE_SAMPLE_RATE = "1";
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${collector.port}/v1/traces`;
    const client = traceConvexClient({ query: async () => "PRIVATE content" } as never);
    const handler = traceBackendHandler(async () => {
      await client.query(ref, { secret: "PRIVATE credential" });
      return new Response("ok");
    });
    await handler(new Request("https://example.test/api/wiki/pages?slugs=PRIVATE"));
    const { flushBackendTraces } = await import("./backend-tracing");
    await flushBackendTraces();
    expect(payloads).toHaveLength(1);
    const spans = JSON.parse(payloads[0]!).resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    const parent = spans.find((span: { name: string }) => span.name === "wiki /api/wiki/pages");
    const child = spans.find((span: { name: string }) => span.name === "convex.query documents:listManifestPage");
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(payloads[0]).not.toContain("PRIVATE");
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
    collector.stop(true);
  }
});
