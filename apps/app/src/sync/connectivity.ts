/**
 * Whether the reader can reach its backend. `navigator.onLine` is only a hint:
 * Chrome can report `false` for hours while requests succeed (VPN and virtual
 * network adapters confuse its detection). Treating that as authoritative made
 * every in-app navigation skip its body fetch and keep the previous page. Any
 * reader response proves connectivity; only a failed request while the browser
 * also reports offline counts as offline.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let online = typeof navigator === "undefined" ? true : navigator.onLine;

function setOnline(next: boolean) {
  if (online === next) return;
  online = next;
  for (const listener of listeners) listener();
}

export function readerOnline() {
  return online;
}

export function subscribeReaderOnline(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A response (any status) arrived, so the network is reachable. */
export function noteNetworkResponse() {
  setOnline(true);
}

/** A request failed without a response. Offline only if the browser agrees. */
export function noteNetworkFailure() {
  if (typeof navigator !== "undefined" && !navigator.onLine) setOnline(false);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}
