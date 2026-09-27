import { useEffect, useState, useSyncExternalStore } from "react";
import type { NavigationFreshness } from "../types";
import { REFRESH_MANIFEST_EVENT } from "../sync/events";

export function useSlowLoading(active: boolean) {
  const [slow, setSlow] = useState(false);
  if (!active && slow) setSlow(false);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [active]);
  return active && slow;
}

export function receivedLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB received` : `${Math.max(1, Math.round(bytes / 1024))} KB received`;
}

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}
const browserOnline = () => navigator.onLine;
export function useBrowserOnline() { return useSyncExternalStore(subscribeOnline, browserOnline); }

export function NavigationStatus({ freshness, hasPages, receivedBytes = 0 }: { freshness: NavigationFreshness; hasPages: boolean; receivedBytes?: number }) {
  const slow = useSlowLoading(freshness === "checking");
  const label = freshness === "checking" ? (hasPages ? "Checking…" : slow ? "Still loading…" : "Loading…") : freshness === "offline" ? (hasPages ? "Saved · offline" : "Offline") : freshness === "saved" ? (hasPages ? "Saved · retrying" : "Retrying…") : "";
  return (
    <div className="reader-navigation-status" data-test-id="navigation-status" data-freshness={freshness}>
      <span>Pages</span>
      <span className="reader-navigation-transfer">
      <span role="status" aria-live="polite" aria-atomic="true" className="reader-navigation-status-detail">
        {label ? <><span className="reader-status-dot" aria-hidden="true" />{label}</> : null}
      </span>
      {freshness === "checking" && slow && receivedBytes > 0 ? <span className="reader-transfer-detail">{receivedLabel(receivedBytes)}</span> : null}
      {freshness === "saved" || slow ? <button type="button" className="reader-transfer-retry" aria-label="Retry loading pages" onClick={() => window.dispatchEvent(new Event(REFRESH_MANIFEST_EVENT))}>Retry</button> : null}
      </span>
    </div>
  );
}
