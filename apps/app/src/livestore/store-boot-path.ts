import type { ReaderStorePath } from "../../shared/reader-telemetry";

// How the running store obtained its initial SQLite image. Kept in a tiny
// module so early telemetry can attach it without importing the OPFS guard.
let current: ReaderStorePath | undefined;

export function setStoreBootPath(path: ReaderStorePath) {
  current = path;
}

export function storeBootPath() {
  return current;
}
