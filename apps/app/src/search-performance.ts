// Exhaustive text search scans the full visible corpus. Keep the launch budget
// explicit so backend integration and browser telemetry use the same threshold.
export const TEXT_SEARCH_LATENCY_BUDGET_MS = 30_000;

export function isWithinTextSearchLatencyBudget(durationMs: number) {
  return durationMs <= TEXT_SEARCH_LATENCY_BUDGET_MS;
}
