import { expect, test } from "bun:test";
import { createSpanBudget, syncErrorReason } from "./reader-telemetry";

test("sync failures map to fixed classes, never messages", () => {
  expect(syncErrorReason("manifest", new Error("Wiki request failed: 503 Service Unavailable"))).toBe("manifest-http5xx");
  expect(syncErrorReason("body", new Error("Wiki request failed: 404 Not Found"))).toBe("body-http4xx");
  expect(syncErrorReason("manifest", new Error("Wiki request timed out after 15000ms"))).toBe("manifest-timeout");
  expect(syncErrorReason("body", new TypeError("Failed to fetch"))).toBe("body-network");
  expect(syncErrorReason("manifest", new SyntaxError("Unexpected token < PRIVATE"))).toBe("manifest-other");
  expect(syncErrorReason("manifest", "PRIVATE")).toBe("manifest-other");
});

test("the span budget allows a boot burst, then refills so a long-lived tab keeps reporting", () => {
  const admit = createSpanBudget(4, 2_000);
  expect([0, 1, 2, 3].map(now => admit(now))).toEqual([true, true, true, true]);
  // A loop cannot exceed the burst.
  expect(admit(4)).toBe(false);
  // Two seconds later one span fits again; an hour later the burst is back, but no more.
  expect(admit(2_004)).toBe(true);
  expect(admit(2_005)).toBe(false);
  expect([0, 1, 2, 3, 4].map(offset => admit(3_600_000 + offset))).toEqual([true, true, true, true, false]);
});
