import { isChunkLoadError } from "../AppErrorBoundary";

// Back-to-back full-page navigations can race the previous page's OPFS store
// shutdown, so the next boot fails transiently even though nothing is wrong
// with the persisted cache. One delayed re-boot absorbs that race; anything
// that fails twice is treated as a real cache problem and surfaces the
// recovery card.
export const STORE_BOOT_MAX_ATTEMPTS = 2;
export const STORE_BOOT_RETRY_DELAY_MS = 1_000;

export function shouldRetryStoreBoot(error: unknown, attempt: number): boolean {
  if (attempt >= STORE_BOOT_MAX_ATTEMPTS - 1) return false;
  // Failed chunk/style loads already have their own reload-once recovery in
  // AppErrorBoundary; re-booting the store cannot fix a missing asset.
  if (isChunkLoadError(error)) return false;
  return true;
}

export function toBootError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
