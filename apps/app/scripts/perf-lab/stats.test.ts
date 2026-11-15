import { describe, expect, test } from "bun:test";
import { checkBudgets, median, relativeSpread, summarize, type BudgetFile } from "./stats";

describe("median", () => {
  test("odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
  test("ignores non-finite values and does not mutate input", () => {
    const input = [5, Number.NaN, 1, Number.POSITIVE_INFINITY, 3];
    expect(median(input)).toBe(3);
    expect(input).toEqual([5, Number.NaN, 1, Number.POSITIVE_INFINITY, 3]);
  });
  test("empty is NaN", () => {
    expect(median([])).toBeNaN();
    expect(median([Number.NaN])).toBeNaN();
  });
});

describe("summarize", () => {
  test("range and count exclude failed samples", () => {
    expect(summarize([10, Number.NaN, 30, 20])).toEqual({ median: 20, min: 10, max: 30, n: 3, samples: [10, Number.NaN, 30, 20] });
  });
  test("relative spread", () => {
    expect(relativeSpread({ median: 100, min: 90, max: 110 })).toBeCloseTo(0.2);
    expect(relativeSpread({ median: 0, min: 0, max: 0 })).toBeNaN();
  });
});

describe("checkBudgets", () => {
  const file: BudgetFile = {
    budgets: {
      a: { max: 100, unit: "ms", baseline: 80, description: "a" },
      b: { max: 1000, unit: "bytes", baseline: 900, description: "b" },
    },
  };
  test("passes at or under the budget", () => {
    const { ok, results } = checkBudgets({ a: 100, b: 10 }, file);
    expect(ok).toBe(true);
    expect(results.map((r) => r.status)).toEqual(["pass", "pass"]);
  });
  test("fails over the budget and reports the overage", () => {
    const { ok, results } = checkBudgets({ a: 130, b: 10 }, file);
    expect(ok).toBe(false);
    expect(results[0]).toMatchObject({ metric: "a", status: "fail", overBy: 30 });
  });
  test("a missing or NaN metric fails", () => {
    expect(checkBudgets({ a: 50 }, file).results[1]!.status).toBe("missing");
    expect(checkBudgets({ a: Number.NaN, b: 1 }, file)).toMatchObject({ ok: false });
  });
  test("a metric whose scenario was not run is skipped, not failed", () => {
    const { ok, results } = checkBudgets({ a: 50 }, file, (metric) => metric === "b");
    expect(ok).toBe(true);
    expect(results[1]!.status).toBe("skipped");
  });
  test("metrics without a budget are ignored", () => {
    expect(checkBudgets({ a: 1, b: 1, c: 1e9 }, file).ok).toBe(true);
  });
});
