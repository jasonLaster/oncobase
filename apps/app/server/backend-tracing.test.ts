import { expect, test } from "bun:test";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { makeFunctionReference } from "convex/server";
import { traceBackendHandler, traceConvexClient, traceBackendPhase, type BackendProfile } from "./backend-tracing";

const ref = makeFunctionReference<"query">("documents:listManifestPage");

test("local publisher can request numeric server phase timings without an OTel collector", async () => {
  const client = traceConvexClient({ query: async () => ({ page: [] }) } as never);
  const handler = traceBackendHandler(async () => {
    await traceBackendPhase("publish.inventory.documents", () => client.query(ref, {}));
    return new Response("ok");
  });
  const request = (route: string, profile: boolean) => new Request(`https://example.test${route}`, {
    headers: profile ? { "X-Publish-Profile": "1" } : {},
  });
  const result = await handler(request("/api/publish/begin", true));
  expect(result!.headers.get("server-timing")).toContain("phase-publish-inventory-documents;dur=");
  expect(result!.headers.get("server-timing")).toContain('convex-count;desc="1"');
  expect((await handler(request("/api/publish/begin", false)))!.headers.get("server-timing")).toBeNull();
  expect((await handler(request("/api/search", true)))!.headers.get("server-timing")).toBeNull();
});

test("publisher spans have fixed routes, adopt valid local parents, and retain inventory RPC parents", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const traceId = "1234567890abcdef1234567890abcdef";
  const spanId = "1234567890abcdef";
  const client = traceConvexClient({ query: async () => ({ page: [] }) } as never);
  const handler = traceBackendHandler(async () => {
    await traceBackendPhase("publish.inventory.documents", () => client.query(ref, {}));
    return new Response("ok");
  }, { tracer: provider.getTracer("publisher-test") });
  try {
    for (const [route, parent] of [
      ["/api/publish/begin", `00-${traceId}-${spanId}-01`],
      ["/api/publish/sync/documents", "00-00000000000000000000000000000000-0000000000000000-01"],
      ["/api/publish/PRIVATE", `00-${traceId}-${spanId}-01`],
    ]) await handler(new Request(`https://example.test${route}?site=PRIVATE`, { headers: { traceparent: parent!, baggage: "PRIVATE" } }));
    const spans = exporter.getFinishedSpans();
    const root = spans.find(s => s.name === "wiki /api/publish/begin")!;
    expect(root.spanContext().traceId).toBe(traceId);
    expect(root.parentSpanContext?.spanId).toBe(spanId);
    const phase = spans.find(s => s.name === "publish.inventory.documents" && s.spanContext().traceId === traceId)!;
    expect(phase.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(spans.find(s => s.kind === 2 && s.spanContext().traceId === traceId)!.parentSpanContext?.spanId).toBe(phase.spanContext().spanId);
    expect(spans.find(s => s.name === "wiki /api/publish/sync/documents")!.parentSpanContext).toBeUndefined();
    expect(spans.find(s => s.name === "wiki /api/other")!.parentSpanContext).toBeUndefined();
    expect(JSON.stringify(spans.map(s => ({ name: s.name, attributes: s.attributes, events: s.events })))).not.toContain("PRIVATE");
  } finally { await provider.shutdown(); }
});

test("session startup diagnostics expose only fixed RPC groups and numbers", async () => {
  const client = traceConvexClient({ query: async () => ({ content: "PRIVATE response" }) } as never);
  const handler = traceBackendHandler(async () => {
    await client.query(makeFunctionReference<"query">("documents:listPage"), { userId: "PRIVATE user" });
    await client.query(makeFunctionReference<"query">("access:filterAccessibleSlugs"), { slugs: ["PRIVATE slug"] });
    return new Response("ok", { headers: { "Cache-Control": "private, no-store" } });
  });
  const ordinary = await handler(new Request("https://example.test/api/wiki/session"));
  expect(ordinary!.headers.get("server-timing")).toBeNull();
  const profiled = await handler(new Request("https://example.test/api/wiki/session?profile=1"));
  const timing = profiled!.headers.get("server-timing")!;
  expect(timing).toContain("db-pages-calls;dur=1");
  expect(timing).toContain("db-access-calls;dur=1");
  expect(timing).toContain("db-failures;dur=0");
  expect(timing).not.toContain("PRIVATE");
  expect(profiled!.headers.get("cache-control")).toBe("private, no-store");
  const other = await handler(new Request("https://example.test/api/search?profile=1"));
  expect(other!.headers.get("server-timing")).toBeNull();
});

test("phase spans parent database reads and record only aggregate result sizes", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const tracer = provider.getTracer("phase-test");
  const client = traceConvexClient({ query: async () => ({ page: [{ content: "PRIVATE" }, { content: "DATA" }] }) } as never);
  const handler = traceBackendHandler(async () => {
    await traceBackendPhase("search.corpus", () => client.query(ref, {}));
    return new Response("ok");
  }, { tracer });
  await handler(new Request("https://example.test/api/search"));
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  const root = spans.find(span => span.name === "wiki /api/search")!;
  const phase = spans.find(span => span.name === "search.corpus")!;
  const query = spans.find(span => span.kind === 2)!;
  expect(phase.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
  expect(query.parentSpanContext?.spanId).toBe(phase.spanContext().spanId);
  expect(query.attributes["convex.result.rows"]).toBe(2);
  expect(query.attributes["convex.result.content_characters"]).toBe(11);
  expect(JSON.stringify(spans.map(span => span.attributes))).not.toContain("PRIVATE");
  await provider.shutdown();
});

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

test("tracing preserves immutable redirect responses", async () => {
  const provider = new BasicTracerProvider();
  const handle = traceBackendHandler(async () => Response.redirect("https://example.test/login", 302), { tracer: provider.getTracer("test") });
  const response = await handle(new Request("https://example.test/api/auth/signout"));
  expect(response?.status).toBe(302);
  expect(response?.headers.get("location")).toBe("https://example.test/login");
  expect(response?.headers.get("X-Oncobase-Trace-Id")).toMatch(/^[a-f0-9]{32}$/);
  await provider.shutdown();
});
