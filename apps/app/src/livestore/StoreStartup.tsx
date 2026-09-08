import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import { useLayoutEffect } from "react";

export const STORE_STARTUP_TIMEOUT_MS = 15_000;

// Mount only while the provider is loading. Stage updates must not restart the
// deadline; unmount (including StrictMode cleanup) cancels stale callbacks.
export function StoreStartupLoading({
  label = "Loading page",
  onTimeout,
  timeoutMs = STORE_STARTUP_TIMEOUT_MS,
}: {
  label?: string;
  onTimeout: () => void;
  timeoutMs?: number;
}) {
  useLayoutEffect(() => {
    const timer = window.setTimeout(onTimeout, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [onTimeout, timeoutMs]);
  return <WikiPageLoading data-test-id="page-loading" includeTags label={label} />;
}
