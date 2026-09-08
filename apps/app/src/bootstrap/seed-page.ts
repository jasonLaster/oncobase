import { expandCompactFileTree, parseWikiManifest, transformFileTreeForSidebar, WIKI_MANIFEST_SCHEMA_VERSION, WIKI_READER_CACHE_VERSION, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { contentSlugFromRouteSlug, pageToEvent, slugFromPath } from "../wiki-utils";
import { parsePageBootstrap, PAGE_BOOTSTRAP_ID } from "./page-payload";
import { bootstrappedNavigation, hasBootstrappedPage, markBootstrappedPage } from "./seed-state";

type BootstrapStore = { commit: (event: ReturnType<typeof pageToEvent>) => unknown };

export function seedPagePayload(store: BootstrapStore, raw: string, identity: WikiSessionIdentity,
  request: { origin: string; pathname: string; apiOrigin: string }) {
  const slug = contentSlugFromRouteSlug(slugFromPath(request.pathname));
  if (hasBootstrappedPage(store, slug)) return false;
  const payload = parsePageBootstrap(raw, { ...request, siteSlug: identity.siteSlug });
  if (!payload || payload.page.slug !== slug) return false;
  // The provider invokes this after identity resolution, before any consumer
  // renders. Always replace an older cached body, even with the same source
  // hash: redaction policy may have changed since that body was persisted.
  store.commit(pageToEvent(payload.page));
  markBootstrappedPage(store, slug);
  return true;
}

export function seedNavigationPayload(store: object, raw: string, identity: WikiSessionIdentity,
  request: { origin: string; pathname: string; apiOrigin: string }) {
  if (raw.length > 1_048_576 || request.origin !== request.apiOrigin) return false;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.readerVersion !== WIKI_READER_CACHE_VERSION ||
        value.origin !== request.origin || value.pathname !== request.pathname ||
        value.siteSlug !== identity.siteSlug || value.scope !== "public") return false;
    const { compactTree } = parseWikiManifest({ schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION,
      siteSlug: value.siteSlug, scope: "public", manifestHash: "", generatedAt: "",
      pages: [], assets: [], compactTree: value.tree });
    // Presentation only: never marks a manifest current, grants access, or
    // suppresses validation. Even an empty authoritative tree replaces this.
    bootstrappedNavigation.set(store, transformFileTreeForSidebar(expandCompactFileTree(compactTree)));
    return true;
  } catch { return false; }
}

export function seedInitialPage(store: BootstrapStore, identity: WikiSessionIdentity) {
  const navigation = document.getElementById("wiki-navigation-bootstrap");
  if (navigation) {
    const raw = navigation.textContent ?? "";
    navigation.remove();
    const age = Date.now() - Number(navigation.dataset.receivedAt);
    if (Number.isFinite(age) && age >= 0 && age <= 60_000) seedNavigationPayload(store, raw, identity, {
      origin: location.origin, pathname: location.pathname,
      apiOrigin: new URL(import.meta.env.VITE_WIKI_API_ORIGIN || location.origin, location.origin).origin,
    });
  }
  const node = document.getElementById(PAGE_BOOTSTRAP_ID);
  if (!node) return;
  // Consume once per HTML response. An identity change or a later recovery
  // must not replay a page after the manifest has revoked its visibility.
  const raw = node.textContent ?? "";
  node.remove();
  const age = Date.now() - Number(node.dataset.receivedAt);
  if (!Number.isFinite(age) || age < 0 || age > 60_000) return;
  const accepted = seedPagePayload(store, raw, identity, {
    origin: location.origin, pathname: location.pathname,
    apiOrigin: new URL(import.meta.env.VITE_WIKI_API_ORIGIN || location.origin, location.origin).origin,
  });
  if (accepted) {
    const host = document.getElementById("wiki-html-first");
    if (host) host.dataset.bootstrapSeeded = "true";
    performance.mark("wiki-page-bootstrap-seeded");
  }
}
