import type { WikiSessionIdentity } from "@oncobase/wiki-content";
import { contentSlugFromRouteSlug, pageToEvent, slugFromPath } from "../wiki-utils";
import { parsePageBootstrap, PAGE_BOOTSTRAP_ID } from "./page-payload";
import { hasBootstrappedPage, markBootstrappedPage } from "./seed-state";

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

export function seedInitialPage(store: BootstrapStore, identity: WikiSessionIdentity) {
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
