import { useLayoutEffect } from "react";
import { AppStarting } from "../AppStarting";

export const STORE_STARTUP_TIMEOUT_MS = 15_000;

// Mount only while the provider is loading. Stage updates must not restart the
// deadline; unmount (including StrictMode cleanup) cancels stale callbacks.
export function StoreStartupLoading({
  stage,
  hideIndicator = false,
  onTimeout,
  timeoutMs = STORE_STARTUP_TIMEOUT_MS,
}: {
  stage?: string;
  hideIndicator?: boolean;
  onTimeout: () => void;
  timeoutMs?: number;
}) {
  useLayoutEffect(() => {
    const timer = window.setTimeout(onTimeout, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [onTimeout, timeoutMs]);
  return hideIndicator ? null : <AppStarting stage={stage} />;
}
