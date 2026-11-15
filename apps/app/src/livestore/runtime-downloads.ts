/** Longest a boot waits for SQLite and the workers before its deadlines start
 * anyway. A link this slow still gets the network-aware deadline afterwards. */
export const RUNTIME_DOWNLOAD_DEADLINE_MS = 60_000;

let downloads: Promise<void> | undefined;

/**
 * The store runtime in the HTTP cache: the head script's downloads when it ran
 * (it also knows the wasm's hashed URL), otherwise `workerUrls` fetched here.
 * Resolves when every file arrived or failed, or at the deadline; never
 * rejects. The adapter constructs its workers only after the wasm loaded, so
 * without this a cold boot downloaded wasm, then workers, in series. Boot
 * deadlines start after this resolves (P18), so a slow link is not mistaken
 * for a stuck store.
 */
export function storeRuntimeDownloads(workerUrls: string[], deadlineMs = RUNTIME_DOWNLOAD_DEADLINE_MS): Promise<void> {
  downloads ??= (() => {
    const early = window.__WIKI_EARLY__;
    early?.startRuntime();
    const started = early?.runtime ?? [];
    const urls = new Set(early?.runtimeUrls.map(url => new URL(url, location.origin).href) ?? []);
    const extra = workerUrls
      .filter(url => !urls.has(new URL(url, location.origin).href))
      .map(url => fetch(url, { credentials: "same-origin" }).then(response => response.ok ? response.arrayBuffer() : null));
    const all = Promise.allSettled([...started, ...extra]).then(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>(resolve => { timer = setTimeout(resolve, deadlineMs); });
    return Promise.race([all, deadline]).finally(() => clearTimeout(timer));
  })();
  return downloads;
}

/** Tests only. */
export function resetStoreRuntimeDownloads() { downloads = undefined; }
