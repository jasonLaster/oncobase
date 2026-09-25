import { registerOTel } from "@vercel/otel";
import { SamplingDecision, type Sampler, type SpanProcessor } from "@opentelemetry/sdk-trace-base";

// Enabling the global SDK must not enable AI/prompt or automatic URL spans.
export const safeSampler: Sampler = {
  shouldSample: (_context, _id, _name, _kind, attributes) => ({
    decision: attributes["oncobase.safe"] === true ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD,
  }),
  toString: () => "OncobaseExplicitInstrumentation",
};
export const redactRequestAttributes: SpanProcessor = {
  onStart: () => {},
  onEnd: span => {
    // The Vercel SDK adds these from request context even with fetch disabled.
    for (const key of ["http.host", "http.user_agent", "http.referer", "vercel.matched_path"]) delete span.attributes[key];
  },
  forceFlush: async () => {},
  shutdown: async () => {},
};

export function registerVercelTracing() {
  registerOTel({
    serviceName: "oncobase",
    instrumentations: [],
    propagators: ["auto"],
    traceSampler: safeSampler,
    spanProcessors: [redactRequestAttributes, "auto"],
    // Native Vercel export is provided by "auto". Suppress the SDK's fallback
    // localhost:4318 exporter; there is no external collector in this setup.
    traceExporter: { export: (_spans, done) => done({ code: 0 }), shutdown: async () => {} },
  });
}
