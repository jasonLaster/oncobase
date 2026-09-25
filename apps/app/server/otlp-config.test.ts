import { expect, test } from "bun:test";
import { externalTraceConfig } from "./otlp-config";

test("Axiom credentials remain exporter headers, with an explicit regional endpoint", () => {
  expect(externalTraceConfig({})).toBeUndefined();
  expect(externalTraceConfig({ AXIOM_API_KEY: "secret", AXIOM_DATASET: "traces", AXIOM_URL: "https://eu-central-1.aws.edge.axiom.co/" })).toEqual({
    url: "https://eu-central-1.aws.edge.axiom.co/v1/traces",
    headers: { Authorization: "Bearer secret", "X-Axiom-Dataset": "traces" }, timeoutMillis: 2000,
  });
});

test("generic OTLP overrides Axiom without sending Axiom credentials to the new destination", () => {
  expect(externalTraceConfig({ AXIOM_API_KEY: "secret", OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.test/" })).toEqual({ url: "https://collector.test/v1/traces", timeoutMillis: 2000 });
  expect(externalTraceConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://ignored.test", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.test/custom" })?.url).toBe("https://collector.test/custom");
});
