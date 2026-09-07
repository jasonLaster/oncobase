// Store-local markers never persist. A remount, another identity, or another
// tab cannot use a previous store's initial-page exemption.
const seededPages = new WeakMap<object, { slug: string; expiresAt: number }>();
export function markBootstrappedPage(store: object, slug: string) {
  seededPages.set(store, { slug, expiresAt: Date.now() + 60_000 });
}
export function hasBootstrappedPage(store: object, slug: string) {
  const value = seededPages.get(store);
  return value?.slug === slug && value.expiresAt > Date.now();
}
import type { WikiSessionIdentity } from "@oncobase/wiki-content";
import type { seedInitialPage } from "./seed-page";

export function createReaderBoot(identity: WikiSessionIdentity) {
  return async (store: Parameters<typeof seedInitialPage>[0]) => {
    if (!document.getElementById("wiki-page-bootstrap")) return;
    const bootstrap = await import("./seed-page").catch(() => null);
    bootstrap?.seedInitialPage(store, identity);
  };
}
