import { useLayoutEffect } from "react";
import { PageTransferActivity } from "../shell/PageTransferActivity";

export const STORE_STARTUP_TIMEOUT_MS = 15_000;

// Mount only while the provider is loading. Stage updates must not restart the
// deadline; unmount (including StrictMode cleanup) cancels stale callbacks.
export function StoreStartupLoading({
  stage,
  onTimeout,
  timeoutMs = STORE_STARTUP_TIMEOUT_MS,
}: {
  stage?: string;
  onTimeout: () => void;
  timeoutMs?: number;
}) {
  useLayoutEffect(() => {
    const timer = window.setTimeout(onTimeout, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [onTimeout, timeoutMs]);
  return <div className="reader-pending" data-test-id="reader-pending" data-startup-stage={stage}>
    <PageTransferActivity label="Opening reader…" onRetry={() => window.location.reload()} />
  </div>;
}
