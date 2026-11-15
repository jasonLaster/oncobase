// Pure statistics and budget comparison for the perf lab (unit-tested).

export type Summary = { median: number; min: number; max: number; n: number; samples: number[] };

/** Median of the finite values (mean of the two middle values for even n); NaN if none. */
export function median(values: readonly number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median, range and sample count. Non-finite samples (a scenario that never became ready) are kept in `samples` as null-ish NaN but excluded from the statistics. */
export function summarize(values: readonly number[]): Summary {
  const finite = values.filter((v) => Number.isFinite(v));
  return {
    median: median(finite),
    min: finite.length ? Math.min(...finite) : Number.NaN,
    max: finite.length ? Math.max(...finite) : Number.NaN,
    n: finite.length,
    samples: [...values],
  };
}

/** Spread as a fraction of the median: (max - min) / median. */
export function relativeSpread(s: Pick<Summary, "median" | "min" | "max">): number {
  if (!Number.isFinite(s.median) || s.median === 0) return Number.NaN;
  return (s.max - s.min) / s.median;
}

export type Budget = { max: number; unit: "ms" | "bytes"; baseline: number; description: string };
export type BudgetFile = { note?: string; budgets: Record<string, Budget> };
export type BudgetStatus = "pass" | "fail" | "missing" | "skipped";
export type BudgetResult = { metric: string; value: number; max: number; unit: Budget["unit"]; status: BudgetStatus; overBy: number };

/**
 * Compare measured medians with the budgets. A metric that is absent or not a
 * finite number is "missing", which counts as a failure: a scenario that never
 * reached its ready state must not pass the gate silently. `skipped` names
 * metrics whose scenario was deliberately not run (a subset run); those do
 * not fail.
 */
export function checkBudgets(metrics: Readonly<Record<string, number | undefined>>, file: BudgetFile, skipped: (metric: string) => boolean = () => false): { ok: boolean; results: BudgetResult[] } {
  const results = Object.entries(file.budgets).map(([metric, budget]): BudgetResult => {
    if (skipped(metric)) return { metric, value: Number.NaN, max: budget.max, unit: budget.unit, status: "skipped", overBy: Number.NaN };
    const value = metrics[metric];
    if (value === undefined || !Number.isFinite(value)) return { metric, value: Number.NaN, max: budget.max, unit: budget.unit, status: "missing", overBy: Number.NaN };
    return { metric, value, max: budget.max, unit: budget.unit, status: value <= budget.max ? "pass" : "fail", overBy: value - budget.max };
  });
  return { ok: results.every((r) => r.status === "pass" || r.status === "skipped"), results };
}
