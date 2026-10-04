import { expect, test } from "bun:test";
import { syncErrorReason } from "./reader-telemetry";

test("sync failures map to fixed classes, never messages", () => {
  expect(syncErrorReason("manifest", new Error("Wiki request failed: 503 Service Unavailable"))).toBe("manifest-http5xx");
  expect(syncErrorReason("body", new Error("Wiki request failed: 404 Not Found"))).toBe("body-http4xx");
  expect(syncErrorReason("manifest", new Error("Wiki request timed out after 15000ms"))).toBe("manifest-timeout");
  expect(syncErrorReason("body", new TypeError("Failed to fetch"))).toBe("body-network");
  expect(syncErrorReason("manifest", new SyntaxError("Unexpected token < PRIVATE"))).toBe("manifest-other");
  expect(syncErrorReason("manifest", "PRIVATE")).toBe("manifest-other");
});
