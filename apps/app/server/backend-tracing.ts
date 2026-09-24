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
  phases: Array<{ name: string; durationMs: number }>;
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

const PUBLISH_ROUTES = new Set([
  "begin", "document", "asset", "asset-hashes", "document-hashes", "finish", "abort",
  "sync/plan", "sync/documents", "sync/assets", "state", "scoped/begin", "scoped/abort", "scoped/finish", "scoped/complete", "status",
].map(step => `/api/publish/${step}`));

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
  return TRACED_ROUTES.has(pathname) || PUBLISH_ROUTES.has(pathname) ? pathname : "/api/other";
}

export function traceBackendHandler(
  handler: (request: Request) => Promise<Response | null>,
  options: { tracer?: Tracer; onProfile?: (profile: BackendProfile) => void } = {},
) {
  return async (request: Request) => {
    const started = performance.now();
    const tracer = options.tracer ?? await backendTracer();
    const profileSession = new URL(request.url).pathname === "/api/wiki/session" &&
      new URL(request.url).searchParams.get("profile") === "1";
    const profilePublish = PUBLISH_ROUTES.has(new URL(request.url).pathname) && request.headers.get("X-Publish-Profile") === "1";
    const timing = process.env.WIKI_BACKEND_TIMING === "1" || profileSession || profilePublish;
    if (!tracer && !timing && !options.onProfile) return handler(request);
    const route = routeName(request);
    const span = tracer?.startSpan(`wiki ${route}`, {
      kind: SpanKind.SERVER,
      attributes: { "http.route": route, "http.request.method": request.method },
    }, publishParent(request));
    const profile: BackendProfile = { route, durationMs: 0, status: 500, calls: [], phases: [] };
    return requests.run({ tracer, span, profile }, async () => {
      try {
        const response = await handler(request);
        profile.status = response?.status ?? 404;
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
        if (profile.status >= 500) span?.setStatus({ code: SpanStatusCode.ERROR });
        return response;
      } catch (error) {
        span?.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        profile.durationMs = performance.now() - started;
        span?.setAttributes({ "http.response.status_code": profile.status, "convex.calls": profile.calls.length, "convex.calls.pending": profile.calls.filter((call) => call.pending).length });
        span?.end();
        try { options.onProfile?.({ ...profile, calls: profile.calls.map((call) => ({ ...call })), phases: profile.phases.map(phase => ({ ...phase })) }); } catch { /* Observers cannot fail requests. */ }
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

/** Fixed names only; record phase timing without recording user data. */
export async function traceBackendPhase<T>(
  name: "search.corpus" | "search.prepare" | "search.match" | "manifest.snapshot-read"
    | "publish.auth" | "publish.lock" | "publish.inventory.documents" | "publish.inventory.assets" | "publish.state" | "publish.reader" | "publish.document.prepare",
  run: () => T | Promise<T>,
): Promise<T> {
  const current = requests.getStore();
  if (!current) return run();
  const started = performance.now();
  const span = current.tracer?.startSpan(name, { kind: SpanKind.INTERNAL }, current.span ? trace.setSpan(ROOT_CONTEXT, current.span) : ROOT_CONTEXT);
  return requests.run({ ...current, span: span ?? current.span }, async () => {
    try { return await run(); }
    catch (error) { span?.setStatus({ code: SpanStatusCode.ERROR }); throw error; }
    finally {
      current.profile.phases.push({ name, durationMs: performance.now() - started });
      span?.end();
    }
  });
}
