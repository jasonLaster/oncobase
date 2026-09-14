import { useSyncExternalStore } from "react";
import type { NavigationFreshness } from "../types";

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}
const browserOnline = () => navigator.onLine;
export function useBrowserOnline() { return useSyncExternalStore(subscribeOnline, browserOnline); }

export function NavigationStatus({ freshness, hasPages }: { freshness: NavigationFreshness; hasPages: boolean }) {
  const label = freshness === "checking" ? (hasPages ? "Checking…" : "Loading…") : freshness === "offline" ? (hasPages ? "Saved · offline" : "Offline") : freshness === "saved" ? (hasPages ? "Saved · retrying" : "Unavailable") : "";
  return (
    <div className="reader-navigation-status" data-test-id="navigation-status" data-freshness={freshness}>
      <span>Pages</span>
      <span role="status" aria-live="polite" aria-atomic="true" className="reader-navigation-status-detail">
        {label ? <><span className="reader-status-dot" aria-hidden="true" />{label}</> : null}
      </span>
    </div>
  );
}
