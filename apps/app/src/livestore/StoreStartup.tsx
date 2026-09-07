import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import { useLayoutEffect } from "react";

export const STORE_STARTUP_TIMEOUT_MS = 15_000;

// Mount only while the provider is loading. Stage updates must not restart the
// deadline; unmount (including StrictMode cleanup) cancels stale callbacks.
export function StoreStartupLoading({
  label = "Loading page",
  onTimeout,
}: {
  label?: string;
  onTimeout: () => void;
}) {
  useLayoutEffect(() => {
    const timer = window.setTimeout(onTimeout, STORE_STARTUP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [onTimeout]);
  return <WikiPageLoading data-test-id="page-loading" includeTags label={label} />;
}
