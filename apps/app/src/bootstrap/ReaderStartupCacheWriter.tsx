import { useStore } from "@livestore/react";
import { WIKI_MANIFEST_SCHEMA_VERSION, WIKI_READER_CACHE_VERSION, type WikiManifest, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { assets$, fileTree$, pageContentBySlug$, pageIndex$, siteState$ } from "../livestore/queries";
import { contentSlugFromRouteSlug, slugFromPath } from "../wiki-utils";
import { parseStartupSnapshot, sameStartupIdentity, startupCacheKey, startupPartition, STARTUP_CACHE_EPOCH, writeStartupSnapshot, type StartupSnapshot } from "./reader-startup-cache";
import { READER_SHELL_COOKIE } from "./reader-shell-hint";
import { encodeStartupSnapshot } from "./encode-startup-cache";

/** A bounded presentation snapshot of actual LiveStore queries. Writes happen
 * after paint; LiveStore remains authoritative and owns all sync/revalidation. */
export function ReaderStartupCacheWriter({ identity }: { identity: WikiSessionIdentity }) {
  const { store } = useStore();
  const { pathname } = useLocation();
  const slug = contentSlugFromRouteSlug(slugFromPath(pathname));
  const state = store.useQuery(siteState$);
  const tree = store.useQuery(fileTree$);
  const pages = store.useQuery(pageIndex$);
  const assets = store.useQuery(assets$);
  const page = store.useQuery(pageContentBySlug$(slug));
  const [epoch] = useState(() => { try { return localStorage.getItem(STARTUP_CACHE_EPOCH); } catch { return null; } });

  useEffect(() => {
    const debug = new URLSearchParams(location.search).get("paintDebug") === "1";
    const report = (result: Record<string, boolean | number | string>) => {
      if (debug) console.info("[wiki-reader-cache]", JSON.stringify(result));
    };
    if (!state?.lastValidatedAt || !tree || state.siteSlug !== identity.siteSlug || state.scope !== identity.scope) {
      report({ status: "waiting", validated: !!state?.lastValidatedAt, tree: !!tree, siteMatches: state?.siteSlug === identity.siteSlug, scopeMatches: state?.scope === identity.scope });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const partition = startupPartition();
        const previous = parseStartupSnapshot(localStorage.getItem(startupCacheKey(partition)), partition);
        const manifest: WikiManifest = { schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION, siteSlug: identity.siteSlug, scope: identity.scope,
          manifestHash: state.manifestHash, generatedAt: state.generatedAt, compactTree: JSON.parse(tree.treeJson),
          pages: pages.map(row => ({ ...row, tags: JSON.parse(row.tagsJson) })), assets: [...assets] };
        const allowed = new Map(pages.map(row => [row.slug, row]));
        // Remove revoked/deleted routes immediately from the next snapshot.
        const bodies = previous && sameStartupIdentity(previous.identity, identity)
          ? previous.bodies.filter(body => allowed.has(body.page.slug) && body.page.slug !== slug &&
            (identity.scope === "session" || !allowed.get(body.page.slug)!.sensitive)) : [];
        if (allowed.has(slug) && page?.content && page.contentStatus === "fresh" && !page.deletedAt && !page.missingAt &&
            (identity.scope === "session" || !page.sensitive)) {
          bodies.unshift({ pathname, fetchedAt: page.fetchedAt, page: { ...page, tags: JSON.parse(page.tagsJson) } });
        }
        const snapshot: StartupSnapshot = { version: 1, partition, readerVersion: WIKI_READER_CACHE_VERSION, identity,
          accountTag: document.querySelector<HTMLMetaElement>('meta[name="wiki-reader-account"]')?.content,
          validatedAt: state.lastValidatedAt, manifest, bodies: bodies.slice(0, 8) };
        // Prefer the current page when quota is tight. Never evict other app data.
        let raw = await encodeStartupSnapshot(snapshot);
        if (cancelled) return;
        let written = raw !== null && writeStartupSnapshot(snapshot, epoch, raw);
        report({ status: "write", written, bytes: raw?.length ?? 0, decodedBytes: new Blob([JSON.stringify(snapshot)]).size, pages: pages.length, bodies: snapshot.bodies.length, epochMatches: localStorage.getItem(STARTUP_CACHE_EPOCH) === epoch });
        while (!written && snapshot.bodies.length) {
          snapshot.bodies.pop();
          raw = await encodeStartupSnapshot(snapshot);
          if (cancelled) return;
          written = raw !== null && writeStartupSnapshot(snapshot, epoch, raw);
        }
        if (!written && localStorage.getItem(STARTUP_CACHE_EPOCH) === epoch) {
          localStorage.removeItem(startupCacheKey(partition));
          document.cookie = `${READER_SHELL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
        }
      } catch { report({ status: "unavailable" }); /* A cache failure must not break the live reader. */ }
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [assets, epoch, identity, page, pages, pathname, slug, state, tree]);
  return null;
}
