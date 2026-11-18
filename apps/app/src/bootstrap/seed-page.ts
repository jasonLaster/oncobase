import type { WikiSessionIdentity } from "@oncobase/wiki-content";
import { parseNavigationBootstrap } from "./initial-reader-data";
import { contentSlugFromRouteSlug, slugFromPath } from "../wiki-utils";
import { pageToEvent } from "../livestore/wiki-events";
import { BOOTSTRAP_MAX_AGE_MS, NAVIGATION_BOOTSTRAP_ID, pageBootstrapFor, PAGE_BOOTSTRAP_ID, releaseBootstrapJson } from "./page-payload";
import { bootstrappedNavigation, hasBootstrappedPage, markBootstrappedPage } from "./seed-state";

type BootstrapStore = { commit: (event: ReturnType<typeof pageToEvent>) => unknown };

export function seedPagePayload(store: BootstrapStore, raw: string, identity: WikiSessionIdentity,
  request: { origin: string; pathname: string; apiOrigin: string }) {
  const slug = contentSlugFromRouteSlug(slugFromPath(request.pathname));
  if (hasBootstrappedPage(store, slug)) return false;
  // A session page seeds only the store opened for the identity it was
  // produced for; a public page seeds any store of this site.
  const page = pageBootstrapFor(raw, { ...request, siteSlug: identity.siteSlug }, identity);
  if (!page || page.slug !== slug) return false;
  // The provider invokes this after identity resolution, before any consumer
  // renders. Always replace an older cached body, even with the same source
  // hash: redaction policy may have changed since that body was persisted.
  store.commit(pageToEvent(page));
  markBootstrappedPage(store, slug);
  return true;
}

export function seedNavigationPayload(store: object, raw: string, identity: WikiSessionIdentity,
  request: { origin: string; pathname: string; apiOrigin: string }) {
  const tree = parseNavigationBootstrap(raw, { ...request, siteSlug: identity.siteSlug }, identity);
  if (!tree) return false;
  // Presentation only; an empty authoritative tree always replaces this.
  bootstrappedNavigation.set(store, tree);
  return true;
}

export function seedInitialPage(store: BootstrapStore, identity: WikiSessionIdentity, request = {
  origin: location.origin, pathname: location.pathname,
  apiOrigin: new URL(import.meta.env.VITE_WIKI_API_ORIGIN || location.origin, location.origin).origin,
}) {
  const navigation = document.getElementById(NAVIGATION_BOOTSTRAP_ID);
  if (navigation) {
    const raw = navigation.textContent ?? "";
    navigation.remove();
    const age = Date.now() - Number(navigation.dataset.receivedAt);
    if (Number.isFinite(age) && age >= 0 && age <= BOOTSTRAP_MAX_AGE_MS) seedNavigationPayload(store, raw, identity, request);
  }
  const node = document.getElementById(PAGE_BOOTSTRAP_ID);
  if (!node) return releaseBootstrapJson();
  // Consume once per HTML response. An identity change or a later recovery
  // must not replay a page after the manifest has revoked its visibility.
  const raw = node.textContent ?? "";
  node.remove();
  const age = Date.now() - Number(node.dataset.receivedAt);
  if (!Number.isFinite(age) || age < 0 || age > BOOTSTRAP_MAX_AGE_MS) return releaseBootstrapJson();
  const accepted = seedPagePayload(store, raw, identity, request);
  releaseBootstrapJson();
  if (accepted) performance.mark("wiki-page-bootstrap-seeded");
}
