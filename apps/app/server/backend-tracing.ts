import { AsyncLocalStorage } from "node:async_hooks";
import { performance as nodePerformance, type EventLoopUtilization } from "node:perf_hooks";
import { ROOT_CONTEXT, propagation, SpanKind, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import type { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { getFunctionName } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";
import { externalTraceConfig } from "./otlp-config";
import { EDUCATION_API_ALIASES, PUBLISH_API_ROUTES, TRACED_API_ROUTES } from "./api-routes";

export type BackendProfile = {
  attributes?: Record<string, string | number | boolean>;
  route: string;
  durationMs: number;
  status: number;
  calls: Array<{ operation: string; name: string; durationMs: number; failed: boolean; pending: boolean }>;
  phases: Array<{ name: string; durationMs: number }>;
};
type RequestTrace = { tracer?: Tracer; span?: Span; root?: Span; profile: BackendProfile; historicalSpans?: boolean };
const requests = new AsyncLocalStorage<RequestTrace>();
let provider: BasicTracerProvider | undefined;
let initializing: Promise<Tracer | undefined> | undefined;

// Process-level signals separate platform bottlenecks from route work: cold
// starts, Fluid Compute concurrency within one instance, and CPU saturation.
let servedRequests = 0;
let inflightRequests = 0;
function eventLoopUtilization(previous?: EventLoopUtilization) {
  try { return nodePerformance.eventLoopUtilization(previous); } catch { return undefined; }
}

/** Class names only (TimeoutError, ConvexError, TypeError): never messages or stacks. */
export function errorType(error: unknown) {
  if (error instanceof Error) return /^[A-Za-z][\w.]{0,63}$/.test(error.name) ? error.name : "Error";
  return typeof error;
}

async function backendTracer(): Promise<Tracer | undefined> {
  if (process.env.WIKI_BACKEND_TRACING === "0") return undefined;
  if (process.env.VERCEL !== "1" && process.env.WIKI_BACKEND_TRACING !== "1") return undefined;
  // Direct OTLP uses a private provider: enabling it cannot capture global AI
  // spans, prompts, automatic fetch URLs or Vercel request metadata.
  initializing ??= (async () => {
    try {
      const external = externalTraceConfig();
      if (process.env.VERCEL === "1" && !external) {
        const { registerVercelTracing } = await import("./vercel-tracing");
        registerVercelTracing();
        return trace.getTracer("oncobase.backend");
      }
      const [{ BasicTracerProvider, BatchSpanProcessor, TraceIdRatioBasedSampler }, { OTLPTraceExporter }, { resourceFromAttributes }] = await Promise.all([
        import("@opentelemetry/sdk-trace-base"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
      ]);
      const defaultRatio = external ? 1 : 0.1;
      const configuredRatio = Number(process.env.WIKI_BACKEND_TRACE_SAMPLE_RATE ?? defaultRatio);
      const ratio = Number.isFinite(configuredRatio) && configuredRatio >= 0 && configuredRatio <= 1 ? configuredRatio : defaultRatio;
      provider = new BasicTracerProvider({
        resource: resourceFromAttributes({ "service.name": "oncobase-backend",
          "deployment.environment.name": process.env.VERCEL_ENV ?? "local",
          ...(process.env.VERCEL_GIT_COMMIT_SHA ? { "service.version": process.env.VERCEL_GIT_COMMIT_SHA } : {}),
        }),
        sampler: new TraceIdRatioBasedSampler(ratio),
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter(external ?? { timeoutMillis: 2000 }), {
          maxQueueSize: 2048, maxExportBatchSize: 128, scheduledDelayMillis: 1000, exportTimeoutMillis: 2500,
        })],
      });
      return provider.getTracer("oncobase.backend");
    } catch {
      return undefined; // Invalid telemetry configuration cannot fail requests.
    }
  })();
  return initializing;
}

export async function flushBackendTraces() {
  try { await provider?.forceFlush(); } catch { /* Telemetry must not fail a response. */ }
}

// Paths can contain document slugs and IDs. Only fixed route families leave
// the process; never record URLs, query strings, headers, bodies, or errors.
// Both sets are derived from the API route table's fixed strings.
const TRACED_ROUTES = TRACED_API_ROUTES;
const PUBLISH_ROUTES = PUBLISH_API_ROUTES;

function publishParent(request: Request) {
  // Correlate only the fixed publisher API. No baggage, URLs or arbitrary headers.
  if (!PUBLISH_ROUTES.has(new URL(request.url).pathname)) return ROOT_CONTEXT;
  const match = request.headers.get("traceparent")?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/);
  if (!match || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!)) return ROOT_CONTEXT;
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: match[1]!, spanId: match[2]!, traceFlags: Number.parseInt(match[3]!, 16), isRemote: true,
  });
}

function routeName(request: Request) {
  const pathname = new URL(request.url).pathname;
  // Education aliases run the canonical handler; group them with it.
  const canonical = EDUCATION_API_ALIASES[pathname] ?? pathname;
  return TRACED_ROUTES.has(canonical) || PUBLISH_ROUTES.has(canonical) ? canonical : "/api/other";
}

export function traceBackendHandler(
  handler: (request: Request) => Promise<Response | null>,
  options: { route?: "/reader/shell"; tracer?: Tracer; onProfile?: (profile: BackendProfile) => void } = {},
) {
  return async (request: Request) => {
    const started = performance.now();
    const tracer = options.tracer ?? await backendTracer();
    const initializationMs = performance.now() - started;
    const profileSession = new URL(request.url).pathname === "/api/wiki/session" &&
      new URL(request.url).searchParams.get("profile") === "1";
    const profilePublish = PUBLISH_ROUTES.has(new URL(request.url).pathname) && request.headers.get("X-Publish-Profile") === "1";
    const timing = process.env.WIKI_BACKEND_TIMING === "1" || profileSession || profilePublish;
    const retained = process.env.VERCEL === "1" && process.env.WIKI_BACKEND_TRACING !== "0";
    if (!tracer && !timing && !options.onProfile && !retained) return handler(request);
    const coldStart = servedRequests++ === 0;
    const eluStarted = eventLoopUtilization();
    const processAttributes = {
      "faas.coldstart": coldStart,
      // Includes this request. Overlap means CPU-bound phases contend.
      "process.inflight_requests": ++inflightRequests,
      // Process start to first request: module evaluation and runtime boot.
      ...(coldStart ? { "faas.init_ms": Math.round(process.uptime() * 1000) } : {}),
    };
    const route = options.route ?? routeName(request);
    const incoming = publishParent(request);
    const clientTraceId = request.headers.get("x-wiki-reader-trace") ?? trace.getSpanContext(incoming)?.traceId;
    const correlation = clientTraceId && /^[a-f0-9]{32}$/.test(clientTraceId) ? clientTraceId : undefined;
    // Use Vercel's infrastructure parent so custom spans appear in its request
    // trace. Keep the CLI/browser's separate trace ID as a join key.
    const historicalSpans = !!externalTraceConfig();
    const parent = retained && !historicalSpans ? propagation.extract(ROOT_CONTEXT, {}, { keys: () => [], get: () => undefined }) : incoming;
    const span = tracer?.startSpan(`wiki ${route}`, {
      kind: SpanKind.SERVER, startTime: Date.now() - (performance.now() - started),
      attributes: { "oncobase.safe": true, "telemetry.init_ms": initializationMs, ...processAttributes, "http.route": route, "http.request.method": request.method,
        ...(EDUCATION_API_ALIASES[new URL(request.url).pathname] ? { "oncobase.route.alias": "education" } : {}), ...(correlation ? { "oncobase.client.trace_id": correlation } : {}) },
    }, parent);
    const profile: BackendProfile = { route, attributes: { "telemetry.init_ms": initializationMs, ...processAttributes }, durationMs: 0, status: 500, calls: [], phases: [] };
    return requests.run({ tracer, span, root: span, profile, historicalSpans }, async () => {
      try {
        let response = await handler(request);
        // Redirect/fetch responses can have immutable headers. Telemetry must
        // not turn an otherwise successful redirect into an application error.
        if (response && (span || timing || retained)) response = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
        profile.status = response?.status ?? 404;
        if (response && span) response.headers.set("X-Oncobase-Trace-Id", span.spanContext().traceId);
        if (response && retained) timingResponse(response, profile, performance.now() - started, span);
        if (timing && response) {
          response.headers.append("Server-Timing", `backend;dur=${(performance.now() - started).toFixed(1)}, convex;dur=${profile.calls.reduce((sum, call) => sum + call.durationMs, 0).toFixed(1)};desc="summed RPC time", convex-count;desc="${profile.calls.length}"`);
          if (profilePublish) {
            const durations = new Map<string, number>();
            for (const phase of profile.phases) durations.set(phase.name, (durations.get(phase.name) ?? 0) + phase.durationMs);
            for (const [name, ms] of durations) response.headers.append("Server-Timing", `phase-${name.replaceAll(".", "-")};dur=${ms.toFixed(1)}`);
          }
          if (profileSession) {
            // Fixed groups and numbers only: no arguments, rows, URLs, user
            // identifiers or error text. Durations sum overlapping RPCs.
            const groups: Record<string, typeof profile.calls> = { pages: [], access: [], combined: [], other: [] };
            for (const call of profile.calls) {
              const group = call.name === "access:listAllowedSensitivePage" ? "combined" : call.name === "documents:listPage" ? "pages" :
                call.name === "access:filterAccessibleSlugs" ? "access" : "other";
              groups[group]!.push(call);
            }
            for (const [name, calls] of Object.entries(groups)) {
              response.headers.append("Server-Timing", `db-${name};dur=${calls.reduce((sum, call) => sum + call.durationMs, 0).toFixed(1)}, db-${name}-calls;dur=${calls.length}`);
            }
            response.headers.append("Server-Timing", `db-failures;dur=${profile.calls.filter(call => call.failed).length}`);
          }
        }
        if (profile.status >= 500) {
          span?.setStatus({ code: SpanStatusCode.ERROR });
          span?.setAttribute("error.type", String(profile.status));
        }
        return response;
      } catch (error) {
        span?.setStatus({ code: SpanStatusCode.ERROR });
        span?.setAttribute("error.type", errorType(error));
        profile.attributes = { ...profile.attributes, "error.type": errorType(error) };
        throw error;
      } finally {
        inflightRequests--;
        profile.durationMs = performance.now() - started;
        const elu = eluStarted && eventLoopUtilization(eluStarted);
        // Bun reports a zero stub; only Node's measured value is meaningful.
        if (elu && elu.active + elu.idle > 0) {
          profile.attributes = { ...profile.attributes, "nodejs.eventloop.utilization": Math.round(elu.utilization * 1000) / 1000 };
          span?.setAttribute("nodejs.eventloop.utilization", Math.round(elu.utilization * 1000) / 1000);
        }
        span?.setAttributes({ "http.response.status_code": profile.status, "convex.calls": profile.calls.length, "convex.calls.pending": profile.calls.filter((call) => call.pending).length,
          "convex.calls.failed": profile.calls.filter((call) => call.failed).length,
          "convex.rpc_sum_ms": Math.round(profile.calls.reduce((sum, call) => sum + call.durationMs, 0) * 10) / 10 });
        span?.end();
        if (retained) console.info("oncobase.backend", JSON.stringify({
          ...profile, calls: profile.calls.slice(0, 128), phases: profile.phases.slice(0, 128),
          traceId: span?.spanContext().traceId, clientTraceId: correlation,
        }));
        try { options.onProfile?.({ ...profile, calls: profile.calls.map((call) => ({ ...call })), phases: profile.phases.map(phase => ({ ...phase })) }); } catch { /* Observers cannot fail requests. */ }
      }
    });
  };
}

// Wrap once per handler, not once per request: existing client-keyed caches
// keep their identity. AsyncLocalStorage isolates overlapping requests.
// Idempotent: the HTML shell and its nested API router share one client, and
// a double proxy would record every RPC twice.
const tracedClients = new WeakSet<ConvexHttpClient>();
export function traceConvexClient(client: ConvexHttpClient, tracerOverride?: Tracer): ConvexHttpClient {
  if (!tracerOverride && tracedClients.has(client)) return client;
  const traced = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "query" && property !== "mutation" && property !== "action") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: Parameters<ConvexHttpClient["query"]>) => {
        const current = requests.getStore();
        if (!current) return value.apply(target, args);
        const name = getFunctionName(args[0]);
        const started = performance.now();
        const tracer = tracerOverride ?? current.tracer;
        const span = tracer?.startSpan(`convex.${property} ${name}`, {
          kind: SpanKind.CLIENT,
          attributes: { "oncobase.safe": true, "rpc.system": "convex", "rpc.method": name, "convex.operation": property },
        }, current.span ? trace.setSpan(ROOT_CONTEXT, current.span) : ROOT_CONTEXT);
        const call = { operation: property, name, durationMs: 0, failed: false, pending: true };
        current.profile.calls.push(call);
        try {
          const result = await value.apply(target, args);
          const rows = Array.isArray(result) ? result : result?.page;
          if (span?.isRecording() && Array.isArray(rows)) {
            span.setAttribute("convex.result.rows", rows.length);
            span.setAttribute("convex.result.content_characters", rows.reduce((sum, row) => sum + (typeof row?.content === "string" ? row.content.length : 0), 0));
          }
          return result;
        }
        catch (error) {
          call.failed = true;
          span?.setStatus({ code: SpanStatusCode.ERROR });
          span?.setAttribute("error.type", errorType(error));
          throw error;
        } finally {
          call.durationMs = performance.now() - started;
          call.pending = false;
          span?.end();
        }
      };
    },
  });
  tracedClients.add(traced);
  return traced;
}

export type BackendPhase = "search.corpus" | "search.prepare" | "search.match" | "manifest.snapshot-read"
  | "publish.auth" | "publish.lock" | "publish.inventory.documents" | "publish.inventory.assets" | "publish.state" | "publish.reader" | "publish.document.prepare"
  // HTML shell: every reader navigation that reaches the origin.
  | "shell.init" | "shell.gate" | "shell.canonical" | "shell.document" | "shell.headers"
  // API router preamble shared by every gated route.
  | "api.gate"
  // Outbound non-Convex dependencies, by peer. Never URLs or object keys.
  | "external.blob" | "external.liveblocks" | "external.openai" | "external.ai-gateway";

/** Fixed names only; record phase timing without recording user data. */
export async function traceBackendPhase<T>(name: BackendPhase, run: () => T | Promise<T>): Promise<T> {
  const current = requests.getStore();
  if (!current) return run();
  const started = performance.now();
  const span = current.tracer?.startSpan(name, { kind: SpanKind.INTERNAL, attributes: { "oncobase.safe": true } }, current.span ? trace.setSpan(ROOT_CONTEXT, current.span) : ROOT_CONTEXT);
  return requests.run({ ...current, span: span ?? current.span }, async () => {
    try { return await run(); }
    catch (error) { span?.setStatus({ code: SpanStatusCode.ERROR }); span?.setAttribute("error.type", errorType(error)); throw error; }
    finally {
      current.profile.phases.push({ name, durationMs: performance.now() - started });
      span?.end();
    }
  });
}

function timingResponse(response: Response, profile: BackendProfile, handlerMs: number, span?: Span) {
  response.headers.append("Server-Timing", `convex-rpc;dur=${profile.calls.reduce((sum, call) => sum + call.durationMs, 0).toFixed(1)}`);
  // Browsers subtract this from fetch/navigation time to separate network,
  // CDN and cold-start overhead from origin work. The trace ID joins the
  // browser's navigation entry to this server span (HTML has no request header).
  response.headers.append("Server-Timing", `app;dur=${handlerMs.toFixed(1)}`);
  if (span) response.headers.append("Server-Timing", `trace;desc="${span.spanContext().traceId}"`);
}

/** Fixed caller-owned attributes only. Never forward request bodies here. */
export function traceBackendAttributes(attributes: Record<string, string | number | boolean>) {
  const current = requests.getStore();
  if (current) {
    current.span?.setAttributes(attributes);
    current.profile.attributes = { ...current.profile.attributes, ...attributes };
  }
}

export type BackendCache = "site-host" | "canonical-slugs" | "pii-patterns" | "search-corpus"
  // Encoded snapshot responses and verified session bases, keyed by hash.
  | "manifest-snapshot";

/**
 * Module caches are per instance; whether Fluid Compute reuse makes them
 * effective is an empirical question. Counts land on the request span.
 */
export function traceBackendCache(name: BackendCache, hit: boolean) {
  const current = requests.getStore();
  if (!current) return;
  const key = `cache.${name}.${hit ? "hits" : "misses"}`;
  const count = Number(current.profile.attributes?.[key] ?? 0) + 1;
  current.profile.attributes = { ...current.profile.attributes, [key]: count };
  current.root?.setAttribute(key, count);
}

export function recordRemoteSpan(name: string, start: number, duration: number, attributes: Record<string, string | number | boolean>, failed = false) {
  const current = requests.getStore();
  const remote = attributes["telemetry.source"] === "browser" || attributes["telemetry.source"] === "convex";
  // Vercel's request trace lookup omits historical spans outside the request
  // window. Represent remote measurements as receipt-time observation spans,
  // preserving the measured clock/duration as attributes and in structured logs.
  // Never shift historical timestamps to fabricate a request waterfall.
  const observation = remote && !current?.historicalSpans;
  const historical = remote && current?.historicalSpans;
  const span = current?.tracer?.startSpan(observation ? `observation.${name}` : name, {
    kind: SpanKind.INTERNAL, ...(observation ? {} : { startTime: start }),
    // A relay receives already-completed work. Link to the receipt, never make
    // that later request the parent of a historical browser/job operation.
    ...(historical && current.span ? { links: [{ context: current.span.spanContext(), attributes: { "telemetry.relationship": "received-by" } }] } : {}),
    attributes: { ...attributes, "oncobase.safe": true,
      ...(remote ? { "measurement.start_unix_ms": start, "measurement.duration_ms": duration } : {}) },
  }, !historical && current?.span ? trace.setSpan(ROOT_CONTEXT, current.span) : ROOT_CONTEXT);
  if (failed) span?.setStatus({ code: SpanStatusCode.ERROR });
  span?.end(observation ? undefined : start + duration);
}

export function backendClientTraceId() {
  const current = requests.getStore();
  return current?.span?.spanContext().traceId;
}
