import { expect, test } from "bun:test";
import { addVisit, requirePrefetchSecret } from "./prefetchPriority";

test("global ranking balances frequency and a 30-day half-life without rescoring jobs", () => {
  const now = 1_800_000_000_000;
  const day = 24 * 60 * 60_000;
  const halfLife = 30 * day;
  const recent = addVisit(undefined, now);
  const older = addVisit(undefined, now - halfLife);
  expect(addVisit(older, now - halfLife)).toBeCloseTo(recent, 10);
  // Compare each visit's effective weight against one visit today.
  expect(Math.exp(addVisit(undefined, now - 7 * day) - recent)).toBeCloseTo(2 ** (-7 / 30), 10);
  expect(Math.exp(older - recent)).toBeCloseTo(0.5, 10);
  expect(Math.exp(addVisit(undefined, now - 2 * halfLife) - recent)).toBeCloseTo(0.25, 10);
  expect(addVisit(recent, now)).toBeGreaterThan(recent);
  expect(addVisit(undefined, now - halfLife * 20)).toBeLessThan(recent);
  expect(Number.isFinite(addVisit(recent, now + halfLife * 10_000))).toBe(true);
});

test("direct Convex ranking and visit calls fail closed without the server key", () => {
  const secret = "a".repeat(64);
  for (const [supplied, expected] of [[secret, undefined], ["", ""], ["a", "a"], ["b".repeat(64), secret]]) {
    expect(() => requirePrefetchSecret(supplied!, expected)).toThrow("Unauthorized");
  }
  expect(() => requirePrefetchSecret(secret, secret)).not.toThrow();
});
