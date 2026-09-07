import { AsyncLocalStorage } from "node:async_hooks";
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import type { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { getFunctionName } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";

export type BackendProfile = {
  route: string;
  durationMs: number;
  status: number;
  calls: Array<{ operation: string; name: string; durationMs: number; failed: boolean; pending: boolean }>;
};
type RequestTrace = { tracer?: Tracer; span?: Span; profile: BackendProfile };
const requests = new AsyncLocalStorage<RequestTrace>();
let provider: BasicTracerProvider | undefined;
let initializing: Promise<Tracer | undefined> | undefined;

async function backendTracer(): Promise<Tracer | undefined> {
  if (process.env.WIKI_BACKEND_TRACING !== "1") return undefined;
  // Load SDK/exporter only when enabled. A private provider avoids activating
  // unrelated AI SDK spans that may capture prompts or clinical content.
  initializing ??= (async () => {
    try {
      const [{ BasicTracerProvider, BatchSpanProcessor, TraceIdRatioBasedSampler }, { OTLPTraceExporter }, { resourceFromAttributes }] = await Promise.all([
        import("@opentelemetry/sdk-trace-base"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
      ]);
      const configuredRatio = Number(process.env.WIKI_BACKEND_TRACE_SAMPLE_RATE ?? "0.1");
      const ratio = Number.isFinite(configuredRatio) && configuredRatio >= 0 && configuredRatio <= 1 ? configuredRatio : 0.1;
      provider = new BasicTracerProvider({
        resource: resourceFromAttributes({ "service.name": "oncobase-backend" }),
        sampler: new TraceIdRatioBasedSampler(ratio),
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ timeoutMillis: 2000 }))],
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
const TRACED_ROUTES = new Set(["/api/admin/access", "/api/admin/roles", "/api/admin/session", "/api/admin/users", "/api/admin/users/role", "/api/ai-search", "/api/auth/session", "/api/auth/signin", "/api/auth/signout", "/api/auth/signup", "/api/chat", "/api/diagnostic-studies", "/api/dicom/annotations", "/api/dicom/comparisons", "/api/dicom/file", "/api/dicom/series", "/api/dicom/studies", "/api/download", "/api/file", "/api/integrations/epic/authorize", "/api/integrations/epic/callback", "/api/integrations/epic/sync", "/api/liveblocks-add-comment", "/api/liveblocks-auth", "/api/liveblocks-delete-thread", "/api/liveblocks-guest", "/api/liveblocks-threads", "/api/liveblocks-users", "/api/liveblocks-webhook", "/api/login", "/api/page-copy", "/api/search", "/api/share-preview", "/api/test/diagnostic-studies", "/api/test/dicom-comparisons", "/api/timeline", "/api/tools", "/api/wiki/manifest", "/api/wiki/pages", "/api/wiki/prefetch", "/api/wiki/session"]);

function routeName(request: Request) {
  const pathname = new URL(request.url).pathname;
  return TRACED_ROUTES.has(pathname) ? pathname : "/api/other";
}

export function traceBackendHandler(
  handler: (request: Request) => Promise<Response | null>,
  options: { tracer?: Tracer; onProfile?: (profile: BackendProfile) => void } = {},
) {
  return async (request: Request) => {
    const started = performance.now();
    const tracer = options.tracer ?? await backendTracer();
    const timing = process.env.WIKI_BACKEND_TIMING === "1";
    if (!tracer && !timing && !options.onProfile) return handler(request);
    const route = routeName(request);
    const span = tracer?.startSpan(`wiki ${route}`, {
      kind: SpanKind.SERVER,
      attributes: { "http.route": route, "http.request.method": request.method },
    }, ROOT_CONTEXT);
    const profile: BackendProfile = { route, durationMs: 0, status: 500, calls: [] };
    return requests.run({ tracer, span, profile }, async () => {
      try {
        const response = await handler(request);
        profile.status = response?.status ?? 404;
        if (timing && response) {
          response.headers.append("Server-Timing", `backend;dur=${(performance.now() - started).toFixed(1)}, convex;dur=${profile.calls.reduce((sum, call) => sum + call.durationMs, 0).toFixed(1)};desc="summed RPC time", convex-count;desc="${profile.calls.length}"`);
        }
        if (profile.status >= 500) span?.setStatus({ code: SpanStatusCode.ERROR });
        return response;
      } catch (error) {
        span?.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        profile.durationMs = performance.now() - started;
        span?.setAttributes({ "http.response.status_code": profile.status, "convex.calls": profile.calls.length, "convex.calls.pending": profile.calls.filter((call) => call.pending).length });
        span?.end();
        try { options.onProfile?.({ ...profile, calls: profile.calls.map((call) => ({ ...call })) }); } catch { /* Observers cannot fail requests. */ }
      }
    });
  };
}

// Wrap once per handler, not once per request: existing client-keyed caches
// keep their identity. AsyncLocalStorage isolates overlapping requests.
export function traceConvexClient(client: ConvexHttpClient, tracerOverride?: Tracer): ConvexHttpClient {
  return new Proxy(client, {
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
          attributes: { "rpc.system": "convex", "rpc.method": name, "convex.operation": property },
        }, current.span ? trace.setSpan(ROOT_CONTEXT, current.span) : ROOT_CONTEXT);
        const call = { operation: property, name, durationMs: 0, failed: false, pending: true };
        current.profile.calls.push(call);
        try { return await value.apply(target, args); }
        catch (error) {
          call.failed = true;
          span?.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          call.durationMs = performance.now() - started;
          call.pending = false;
          span?.end();
        }
      };
    },
  });
}
