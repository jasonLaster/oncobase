// Server-only configuration. Standard OTLP variables take precedence so changing
// providers does not require changing instrumentation or adding a vendor SDK.
export function externalTraceConfig(env: Record<string, string | undefined> = process.env) {
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    (env.OTEL_EXPORTER_OTLP_ENDPOINT ? `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces` : undefined);
  if (endpoint) return { url: endpoint, timeoutMillis: 2000 };
  if (!env.AXIOM_API_KEY) return undefined;
  return {
    url: `${(env.AXIOM_URL || "https://api.axiom.co").replace(/\/$/, "")}/v1/traces`,
    headers: { Authorization: `Bearer ${env.AXIOM_API_KEY}`, "X-Axiom-Dataset": env.AXIOM_DATASET || "oncobase-traces" },
    timeoutMillis: 2000,
  };
}
