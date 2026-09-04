export type ReaderStorageMode = "opfs" | "memory";

/** A browser may expose OPFS while denying access (for example private sessions).
 * Probe before booting the worker: the adapter can otherwise remain loading
 * forever without delivering the failure to the React error boundary.
 */
export async function resolveReaderStorage(
  storage: Pick<StorageManager, "getDirectory"> | undefined,
): Promise<ReaderStorageMode> {
  try {
    if (!storage?.getDirectory) return "memory";
    await storage.getDirectory();
    return "opfs";
  } catch {
    return "memory";
  }
}
