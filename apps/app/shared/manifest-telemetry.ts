export const MANIFEST_PHASES = ["revision", "deltaRead", "read", "filter", "tree", "hash", "serialize", "store", "install"] as const;
export type ManifestTelemetry = {
  version: 1; startedAt: number; queuedAt?: number; revision: number; clientTraceId?: string;
  durationMs: number; incremental: boolean;
  outcome: "installed" | "missing-site" | "active-writer" | "stale-revision" | "failed";
  failureStage: "none" | "revision" | "assemble" | "store" | "install";
  phases: Partial<Record<typeof MANIFEST_PHASES[number], number>>;
};

export function parseManifestTelemetry(input: unknown, now = Date.now()): ManifestTelemetry | null {
  if (!input || typeof input !== "object") return null;
  const b = input as ManifestTelemetry;
  if (b.version !== 1 || !Number.isFinite(b.startedAt) || Math.abs(b.startedAt - now) > 3600_000 || !Number.isFinite(b.durationMs) || b.durationMs < 0 || b.durationMs > 3600_000 || !Number.isInteger(b.revision) || b.revision < -1 || typeof b.incremental !== "boolean" || !["installed", "missing-site", "active-writer", "stale-revision", "failed"].includes(b.outcome) || !["none", "revision", "assemble", "store", "install"].includes(b.failureStage) || !b.phases || typeof b.phases !== "object") return null;
  const phases: ManifestTelemetry["phases"] = {};
  for (const key of MANIFEST_PHASES) {
    const value = b.phases[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 3600_000) phases[key] = value;
  }
  return { version: 1, startedAt: b.startedAt, durationMs: b.durationMs, revision: b.revision, incremental: b.incremental, outcome: b.outcome, failureStage: b.failureStage, phases,
    ...(typeof b.queuedAt === "number" && Number.isFinite(b.queuedAt) && b.queuedAt <= b.startedAt && b.startedAt - b.queuedAt < 86400_000 ? { queuedAt: b.queuedAt } : {}),
    ...(typeof b.clientTraceId === "string" && /^[a-f0-9]{32}$/.test(b.clientTraceId) ? { clientTraceId: b.clientTraceId } : {}),
  };
}
