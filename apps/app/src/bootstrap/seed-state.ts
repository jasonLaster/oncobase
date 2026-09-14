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
export const bootstrappedNavigation = new WeakMap<object, import("@oncobase/wiki-content").FileNode[]>();

import type { WikiSessionIdentity } from "@oncobase/wiki-content";
import type { seedInitialPage } from "./seed-page";
import { markVisualPhase } from "../visual-phase";

export function createReaderBoot(identity: WikiSessionIdentity) {
  // Download code while the adapter starts; only the boot callback may apply
  // the response to the validated store. Missing/failed imports retain the API
  // fallback, and do not consume the response ahead of database readiness.
  const bootstrap = document.querySelector("#wiki-page-bootstrap, #wiki-navigation-bootstrap")
    ? import("./seed-page").catch(() => null)
    : Promise.resolve(null);
  return async (store: Parameters<typeof seedInitialPage>[0]) => {
    markVisualPhase("store-boot-enter");
    (await bootstrap)?.seedInitialPage(store, identity);
    markVisualPhase("store-boot-complete");
  };
}
