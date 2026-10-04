import { recordReaderPhase, recordSessionHandoff } from "./reader-telemetry";
import type { ReaderHandoffOutcome } from "../shared/reader-telemetry";
import type { VisualStabilityObserver } from "./visual-stability";

// Keep lifecycle marks tiny on the normal reader path. The frame sampler and
// performance observers are downloaded only when diagnostics are requested.
export function markVisualPhase(name: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  recordReaderPhase(name, data);
  const observer: VisualStabilityObserver | undefined = window.__WIKI_VISUAL_STABILITY__;
  observer?.mark(name, data);
}

/** The session-handoff span plus a matching local diagnostics mark. */
export function markSessionHandoff(outcome: ReaderHandoffOutcome, startedAt: number) {
  if (typeof window === "undefined") return;
  const now = performance.now();
  recordSessionHandoff(outcome, startedAt, now);
  window.__WIKI_VISUAL_STABILITY__?.mark("session-handoff", { outcome, waitMs: Math.round(now - startedAt) });
}
