export const READER_STORAGE_PROBE_TIMEOUT_MS = 3_000;
export const READER_LEADER_BOOT_TIMEOUT_MS = 3_000;
export const READER_FOLLOWER_BOOT_TIMEOUT_MS = 750;

/** Inspect before mounting the provider, so its own lock cannot be mistaken
 * for an existing leader. A read-only, bounded probe must not delay startup
 * indefinitely or disturb another tab's ownership of persisted data. */
export async function readerBootDeadline(
  locks: Pick<LockManager, "query"> | undefined,
  storeId: string,
  probeTimeoutMs = 25,
): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!locks?.query) return READER_LEADER_BOOT_TIMEOUT_MS;
    return await Promise.race([
      Promise.resolve().then(() => locks.query()).then(snapshot =>
        snapshot.held?.some(lock => lock.name === `livestore-tab-lock-${storeId}`)
          ? READER_FOLLOWER_BOOT_TIMEOUT_MS : READER_LEADER_BOOT_TIMEOUT_MS),
      new Promise<number>(resolve => {
        timer = setTimeout(() => resolve(READER_LEADER_BOOT_TIMEOUT_MS), probeTimeoutMs);
      }),
    ]);
  } catch {
    return READER_LEADER_BOOT_TIMEOUT_MS;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type ReaderStorageMode = "opfs" | "memory";

/** Per-document diagnostic comparison; never changes saved preferences or
 * deletes persistence. Both paths still use the same LiveStore schema. */
export function isDiagnosticMemoryStorageRequest(url: URL) {
  return url.searchParams.get("paintDebug") === "1" && url.searchParams.get("readerStorage") === "memory";
}

/** A browser may expose OPFS while denying access (for example private sessions).
 * Probe before booting the worker: the adapter can otherwise remain loading
 * forever without delivering the failure to the React error boundary.
 */
export async function resolveReaderStorage(
  storage: Pick<StorageManager, "getDirectory"> | undefined,
  timeoutMs = READER_STORAGE_PROBE_TIMEOUT_MS,
): Promise<ReaderStorageMode> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!storage?.getDirectory) return "memory";
    return await Promise.race([
      Promise.resolve().then(() => storage.getDirectory()).then(() => "opfs" as const),
      new Promise<ReaderStorageMode>((resolve) => {
        timer = setTimeout(() => resolve("memory"), timeoutMs);
      }),
    ]);
  } catch {
    return "memory";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
