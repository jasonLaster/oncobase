// Leader-worker boot timings, observed without patching LiveStore: the worker
// script start, and the library's own performance measures for wasm load +
// OPFS open (`InitialMessage`) and state-db recreation. Workers cannot reach
// the page's telemetry queue, so they broadcast absolute numbers; the page
// keeps only its own session's worker (by name suffix) and never forwards names.
export const WORKER_BOOT_CHANNEL = "oncobase:livestore-worker-boot";
export type WorkerBootKind = "script" | "db-open" | "recreate";
export type WorkerBootMessage = { worker: string; kind: WorkerBootKind; at: number; duration: number };
const MEASURES: Record<string, WorkerBootKind> = {
  "@livestore/adapter-web:worker:InitialMessage": "db-open",
  "@livestore/common:leader-thread:recreateDb": "recreate",
};

/** Calls `record` for the library's named `performance.measure` entries in this realm. */
export function observeMeasures<K extends string>(names: Record<string, K>, record: (kind: K, start: number, duration: number) => void) {
  try {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("measure")) return;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const kind = names[entry.name];
        if (kind) record(kind, entry.startTime, entry.duration);
      }
    }).observe({ type: "measure", buffered: true });
  } catch { /* Optional diagnostics. */ }
}

/** Worker side. `at` is epoch milliseconds (shared monotonic clock origin). */
export function reportWorkerBoot(scriptStart: number) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(WORKER_BOOT_CHANNEL);
    const worker = String((globalThis as { name?: unknown }).name ?? "");
    const post = (kind: WorkerBootKind, start: number, duration: number) =>
      channel.postMessage({ worker, kind, at: performance.timeOrigin + start, duration } satisfies WorkerBootMessage);
    post("script", scriptStart, 0);
    observeMeasures(MEASURES, post);
  } catch { /* Diagnostics never affect the worker. */ }
}

/** Page side: messages from this document's own leader worker only. */
export function observeWorkerBoot(sessionId: string, record: (message: WorkerBootMessage) => void) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    new BroadcastChannel(WORKER_BOOT_CHANNEL).onmessage = ({ data }: MessageEvent<Partial<WorkerBootMessage>>) => {
      if (typeof data?.worker !== "string" || !data.worker.endsWith(`-${sessionId}`) || !(data.kind && data.kind in KINDS) ||
        !Number.isFinite(data.at) || !Number.isFinite(data.duration)) return;
      record(data as WorkerBootMessage);
    };
  } catch { /* Optional diagnostics. */ }
}
const KINDS: Record<WorkerBootKind, true> = { script: true, "db-open": true, recreate: true };
