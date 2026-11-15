import liveStoreSharedWorkerUrl from "@livestore/adapter-web/shared-worker?sharedworker&url";
import liveStoreWorkerUrl from "./livestore.worker?worker&url";

/** Longest a boot waits for SQLite and the workers before its deadlines start
 * anyway. A link this slow still gets the network-aware deadline afterwards. */
export const RUNTIME_DOWNLOAD_DEADLINE_MS = 60_000;

let downloads: Promise<void> | undefined;

/**
 * The store runtime in the HTTP cache: the head script's downloads when it ran
 * (it also knows the wasm's hashed URL), otherwise the worker scripts fetched
 * here. Resolves when every file arrived or failed, or at the deadline; never
 * rejects. The adapter constructs its workers only after the wasm loaded, so
 * without this a cold boot downloaded wasm, then workers, in series.
 */
export function storeRuntimeDownloads(deadlineMs = RUNTIME_DOWNLOAD_DEADLINE_MS): Promise<void> {
  downloads ??= (() => {
    const early = window.__WIKI_EARLY__;
    early?.startRuntime();
    const started = early?.runtime ?? [];
    const urls = new Set(early?.runtimeUrls.map(url => new URL(url, location.origin).href) ?? []);
    const extra = [liveStoreSharedWorkerUrl, liveStoreWorkerUrl]
      .filter(url => !urls.has(new URL(url, location.origin).href))
      .map(url => fetch(url, { credentials: "same-origin" }).then(response => response.ok ? response.arrayBuffer() : null));
    const all = Promise.allSettled([...started, ...extra]).then(() => undefined);
    return Promise.race([all, new Promise<void>(resolve => setTimeout(resolve, deadlineMs))]);
  })();
  return downloads;
}
