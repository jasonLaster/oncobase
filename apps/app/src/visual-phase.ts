import { recordReaderPhase } from "./reader-telemetry";
import type { VisualStabilityObserver } from "./visual-stability";

// Keep lifecycle marks tiny on the normal reader path. The frame sampler and
// performance observers are downloaded only when diagnostics are requested.
export function markVisualPhase(name: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  recordReaderPhase(name, data);
  const observer: VisualStabilityObserver | undefined = window.__WIKI_VISUAL_STABILITY__;
  observer?.mark(name, data);
}
