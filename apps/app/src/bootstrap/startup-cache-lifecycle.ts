import { WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { READER_SHELL_COOKIE } from "./reader-shell-hint";

// Entry/login code must invalidate reader caches without loading the SQLite schema.
export const STARTUP_CACHE_EPOCH = "wiki-vite:startup-epoch";
export function startupCacheKey(partition: string) { return `wiki-vite:startup:${WIKI_READER_CACHE_VERSION}:${partition}`; }
export function startupPartition() {
  return `${location.origin}|${new URL(import.meta.env.VITE_WIKI_API_ORIGIN || location.origin, location.origin).origin}`;
}
export function clearStartupSnapshot() {
  try {
    localStorage.removeItem(startupCacheKey(startupPartition()));
    localStorage.setItem(STARTUP_CACHE_EPOCH, crypto.randomUUID());
  } catch { /* Storage is optional. */ }
  try { document.cookie = `${READER_SHELL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`; } catch { /* Cookies can be disabled separately. */ }
}
