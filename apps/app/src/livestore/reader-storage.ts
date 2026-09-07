export const READER_STORAGE_PROBE_TIMEOUT_MS = 3_000;

export type ReaderStorageMode = "opfs" | "memory";

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
