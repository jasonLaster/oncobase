import { describe, expect, test } from "bun:test";
import {
  isWithinTextSearchLatencyBudget,
  TEXT_SEARCH_LATENCY_BUDGET_MS,
} from "./search-performance";

describe("text search latency budget", () => {
  test("accepts the budget boundary and rejects slower searches", () => {
    expect(isWithinTextSearchLatencyBudget(TEXT_SEARCH_LATENCY_BUDGET_MS)).toBe(true);
    expect(isWithinTextSearchLatencyBudget(TEXT_SEARCH_LATENCY_BUDGET_MS + 1)).toBe(false);
  });
});
