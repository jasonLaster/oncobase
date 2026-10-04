import { useCallback, useSyncExternalStore } from "react";

// Byte progress ticks every ~250 ms during transfers. Keeping it out of React
// state means only the small activity indicators that display it re-render,
// not the reader (App → WikiPage → markdown) on every tick.

type PageTransfer = { slug: string; receivedBytes: number };

let manifestReceivedBytes = 0;
let pageTransfer: PageTransfer | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setManifestReceivedBytes(bytes: number) {
  if (bytes === manifestReceivedBytes) return;
  manifestReceivedBytes = bytes;
  emit();
}

export function setPageTransfer(next: PageTransfer | null) {
  if (next?.slug === pageTransfer?.slug && next?.receivedBytes === pageTransfer?.receivedBytes) return;
  pageTransfer = next;
  emit();
}

export function readTransferProgress() {
  return { manifestReceivedBytes, pageTransfer };
}

/**
 * Bytes received for the manifest. Pass `active: false` while the value is not
 * displayed so ticks don't re-render the caller at all.
 */
export function useManifestReceivedBytes(active = true) {
  return useSyncExternalStore(subscribe, () => (active ? manifestReceivedBytes : 0), () => 0);
}

/** Bytes received for `slug`'s body (0 for any other page), gated like above. */
export function usePageReceivedBytes(slug: string | undefined, active = true) {
  const snapshot = useCallback(
    () => (active && slug !== undefined && pageTransfer?.slug === slug ? pageTransfer.receivedBytes : 0),
    [active, slug],
  );
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
