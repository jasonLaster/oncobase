import type { ReaderReason } from "../../shared/reader-telemetry";
import { recordReaderPhase } from "../reader-telemetry";

/**
 * Why this page's reader ended up without its persistent store: the storage
 * probe's answer (unsupported, denied, timed out, or a diagnostic request) or
 * the boot milestone a store timeout stopped at. Kept on the document for
 * diagnostics and tests, and sent as a `store-fallback` span so memory boots
 * can be explained in production.
 */
export function recordStoreFallback(reason: ReaderReason) {
  try {
    document.documentElement.dataset.readerStoreFallback = reason;
    performance.mark("wiki-reader-store-fallback", { detail: { reason } });
  } catch { /* Diagnostics only. */ }
  recordReaderPhase("store-fallback", { reason });
}
