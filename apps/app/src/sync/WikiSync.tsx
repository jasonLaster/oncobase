import { useStore } from "@livestore/react";
import {
  createWikiContentClient,
  WIKI_MANIFEST_SCHEMA_VERSION,
  type CompactFileNode,
  type WikiManifest,
  type WikiManifestValidation,
  type WikiManifestPage,
  type WikiScope,
} from "@oncobase/wiki-content";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  assets$,
  fileTree$,
  pageContentBySlug$,
  pageIndex$,
  pageIndexBySlug$,
  siteState$,
} from "../livestore/queries";
import { events } from "../livestore/schema";
import type {
  AssetIndexRow,
  MetricsPatch,
  PageContentRow,
  PageIndexRow,
  SiteStateRow,
} from "../types";
import { useWikiScope } from "../wiki-context";
import {
  byteSize,
  contentSlugFromRouteSlug,
  isAuthError,
  manifestToEvent,
  normalizeFetchedPageSlug,
  pageToEvent,
  parseJsonArray,
  rememberSlug,
  slugFromPath,
  storageSnapshot,
} from "../wiki-utils";

import { BackgroundPrefetch, FOREGROUND_FETCH_EVENT } from "./BackgroundPrefetch";
import { PREFETCH_LIMITS } from "./prefetch-policy";
import { hasBootstrappedPage } from "../bootstrap/seed-state";
export { WARM_CACHE_EVENT } from "./BackgroundPrefetch";
export const RETRY_PAGE_EVENT = "wiki-vite:retry-page";
export const REFRESH_MANIFEST_EVENT = "wiki-vite:refresh-manifest";

const MANIFEST_FRESH_MS: Record<WikiScope, number> = {
  public: 60_000,
  session: 30_000,
};
const MANIFEST_RETRY_MS = 30_000;

export function WikiSync({ onMetrics }: { onMetrics: (patch: MetricsPatch) => void }) {
  const { store } = useStore();
  const scope = useWikiScope();
  const location = useLocation();
  const currentSlug = contentSlugFromRouteSlug(slugFromPath(location.pathname));
  const [networkTick, setNetworkTick] = useState(0);
  const manifestRef = useRef<WikiManifest | null>(null);
  const currentSlugRef = useRef(currentSlug);
  // The HTTP page can be newer than a recently cached navigation manifest.
  const forceValidationRef = useRef(hasBootstrappedPage(store, currentSlug));
  const validationInFlight = useRef<{
    key: string;
    promise: Promise<WikiManifestValidation>;
  } | null>(null);
  const inFlight = useRef(new Set<string>());
  const isForegroundBusy = useCallback(
    () => inFlight.current.size > 0 || validationInFlight.current !== null,
    [],
  );
  useEffect(() => {
    currentSlugRef.current = currentSlug;
  }, [currentSlug]);
  const client = useMemo(() => {
    const baseUrl = import.meta.env.VITE_WIKI_API_ORIGIN ?? "";
    return createWikiContentClient({
      scope,
      baseUrl,
      credentials: baseUrl ? "include" : "same-origin",
      requestTimeoutMs: 30_000,
    });
  }, [scope]);

  const readCachedManifest = useCallback((): WikiManifest | null => {
    const state = store.query(siteState$) as SiteStateRow | null;
    const fileTree = store.query(fileTree$) as { treeJson: string } | null;
    if (!state?.manifestHash || state.scope !== scope || !fileTree) return null;

    const pages = store.query(pageIndex$) as PageIndexRow[];
    const assets = store.query(assets$) as AssetIndexRow[];
    return {
      schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION,
      siteSlug: state.siteSlug,
      scope: state.scope,
      manifestHash: state.manifestHash,
      generatedAt: state.generatedAt,
      compactTree: parseJsonArray<CompactFileNode>(fileTree.treeJson),
      pages: pages.map((page) => ({
        slug: page.slug,
        title: page.title,
        tags: parseJsonArray<string>(page.tagsJson),
        description: page.description,
        contentHash: page.contentHash,
        sensitive: page.sensitive,
        size: page.size,
      })),
      assets: assets.map((asset) => ({ ...asset })),
    };
  }, [scope, store]);

  const fetchSlug = useCallback(
    async (slug: string, pageIndex?: WikiManifestPage) => {
      const cacheKey = `${scope}:${slug}`;
      if (inFlight.current.has(cacheKey)) return;

      const cached = store.query(pageContentBySlug$(slug)) as PageContentRow | null;
      if (
        cached?.content &&
        pageIndex &&
        cached.contentHash === pageIndex.contentHash &&
        cached.contentStatus === "fresh" &&
        Date.now() - cached.fetchedAt < PREFETCH_LIMITS.revalidateMs
      ) {
        return;
      }

      inFlight.current.add(cacheKey);
      window.dispatchEvent(new Event(FOREGROUND_FETCH_EVENT));
      try {
        const batch = await client.fetchPages({ slugs: [slug] });
        const page = normalizeFetchedPageSlug(slug, batch.pages);
        if (page) {
          store.commit(pageToEvent(page));
          onMetrics({
            markdownBytes: page.size,
            eventCount: 1,
            ...(slug === currentSlugRef.current ? { failedBodySlug: null } : {}),
          });
        } else {
          const unavailable = batch.unavailable?.find((item) => item.slug === slug);
          if (unavailable) {
            store.commit(
              events.pageContentUnavailable({
                slug: unavailable.slug,
                title: unavailable.title,
                tags: unavailable.tags,
                contentHash: unavailable.contentHash,
                sensitive: unavailable.sensitive,
                size: unavailable.size,
                unavailableAt: Date.now(),
              }),
            );
            onMetrics({ eventCount: 1 });
            return;
          }
          store.commit(
            events.pageContentMissing({
              slug,
              contentHash: pageIndex?.contentHash ?? null,
              missingAt: Date.now(),
            }),
          );
          onMetrics({ eventCount: 1 });
        }
      } catch (error) {
        if (scope === "session" && isAuthError(error)) {
          store.commit(events.cacheResetRequested({ requestedAt: Date.now() }));
          onMetrics({
            status: "error",
            message: "Session expired; local session cache cleared",
            eventCount: 1,
            failedBodyFetches: 1,
          });
        } else {
          onMetrics({
            ...(slug === currentSlugRef.current
              ? {
                  status: "error" as const,
                  message: `Failed to fetch markdown for ${slug}`,
                  failedBodySlug: slug,
                }
              : {}),
            failedBodyFetches: 1,
          });
        }
        throw error;
      } finally {
        inFlight.current.delete(cacheKey);
      }
    },
    [client, onMetrics, scope, store],
  );

  useEffect(() => {
    const onOnline = () => setNetworkTick((value) => value + 1);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setNetworkTick((value) => value + 1);
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const onRefreshManifest = () => {
      forceValidationRef.current = true;
      setNetworkTick((value) => value + 1);
    };
    window.addEventListener(REFRESH_MANIFEST_EVENT, onRefreshManifest);
    return () => window.removeEventListener(REFRESH_MANIFEST_EVENT, onRefreshManifest);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;

    const scheduleRefresh = (delayMs: number) => {
      refreshTimer = window.setTimeout(
        () => setNetworkTick((value) => value + 1),
        Math.max(0, delayMs),
      );
    };

    async function run() {
      const cachedManifest =
        manifestRef.current?.scope === scope
          ? manifestRef.current
          : readCachedManifest();
      manifestRef.current = cachedManifest;
      const cachedState = store.query(siteState$) as SiteStateRow | null;
      const now = Date.now();
      const forceValidation = forceValidationRef.current;
      forceValidationRef.current = false;
      const freshnessMs = MANIFEST_FRESH_MS[scope];
      const cacheAge = cachedState ? now - cachedState.lastValidatedAt : Number.POSITIVE_INFINITY;

      if (cachedManifest && !forceValidation && cacheAge < freshnessMs) {
        onMetrics({
          status: "ready",
          message: `Using fresh manifest ${cachedManifest.manifestHash.slice(0, 8)}`,
          manifestBytes: cachedState?.manifestSize ?? 0,
        });
        scheduleRefresh(freshnessMs - cacheAge);
        return;
      }

      if (!navigator.onLine) {
        onMetrics({ status: "offline", message: "Offline: using local cache" });
        return;
      }

      const syncStart = performance.now();
      onMetrics({
        status: "syncing",
        message: cachedManifest ? "Checking for wiki updates" : "Loading manifest",
      });
      try {
        const validationKey = `${scope}:${cachedManifest?.manifestHash ?? "empty"}`;
        const validationPromise =
          validationInFlight.current?.key === validationKey
            ? validationInFlight.current.promise
            : client.validateManifest(cachedManifest?.manifestHash);
        validationInFlight.current = {
          key: validationKey,
          promise: validationPromise,
        };
        window.dispatchEvent(new Event(FOREGROUND_FETCH_EVENT));
        let validation: WikiManifestValidation;
        try {
          validation = await validationPromise;
        } finally {
          if (validationInFlight.current?.promise === validationPromise) {
            validationInFlight.current = null;
          }
        }
        if (cancelled) return;
        const validatedAt = Date.now();
        const hasCompleteSnapshot =
          Boolean(cachedManifest) && (cachedState?.lastValidatedAt ?? 0) > 0;
        if (validation.status === "unchanged" && cachedManifest) {
          if (validation.partial) {
            onMetrics({
              status: "ready",
              message: hasCompleteSnapshot
                ? "Partial refresh ignored; using complete cached manifest"
                : "Provisional manifest loaded; retrying full manifest",
              manifestBytes: cachedState?.manifestSize ?? 0,
            });
            scheduleRefresh(MANIFEST_RETRY_MS);
            return;
          }
          store.commit(
            events.manifestValidated({
              manifestHash: cachedManifest.manifestHash,
              validatedAt,
            }),
          );
          onMetrics({
            status: "ready",
            message: `Manifest ${cachedManifest.manifestHash.slice(0, 8)} is current`,
            manifestBytes: cachedState?.manifestSize ?? 0,
            eventCount: 1,
            lastSyncMs: performance.now() - syncStart,
          });
          scheduleRefresh(freshnessMs);
          return;
        }

        if (validation.status !== "modified") {
          throw new Error("Manifest validation returned no replacement snapshot");
        }
        if (validation.partial && hasCompleteSnapshot) {
          onMetrics({
            status: "ready",
            message: "Partial refresh ignored; using complete cached manifest",
            manifestBytes: cachedState?.manifestSize ?? 0,
          });
          scheduleRefresh(MANIFEST_RETRY_MS);
          return;
        }
        const manifest = validation.manifest;
        manifestRef.current = manifest;
        // A manifest is one LiveStore event, so its tree and indexes replace
        // the prior snapshot in the materializer's single transaction.
        if (validation.partial) {
          store.commit(
            manifestToEvent(manifest, validatedAt),
            events.manifestMarkedProvisional({
              manifestHash: manifest.manifestHash,
            }),
          );
        } else {
          store.commit(manifestToEvent(manifest, validatedAt));
        }
        const activeSlug = currentSlugRef.current;
        const activePage = manifest.pages.find((page) => page.slug === activeSlug);
        void fetchSlug(activeSlug, activePage).catch(() => undefined);
        const storage = await storageSnapshot();
        onMetrics({
          status: "ready",
          message: validation.partial
            ? "Provisional manifest loaded; retrying full manifest"
            : `Manifest ${manifest.manifestHash.slice(0, 8)} loaded`,
          manifestBytes: byteSize(JSON.stringify(manifest)),
          eventCount: 1,
          lastSyncMs: performance.now() - syncStart,
          opfsBytes: storage.usage,
          storageQuotaBytes: storage.quota,
          storagePressure: storage.pressure,
        });
        scheduleRefresh(validation.partial ? MANIFEST_RETRY_MS : freshnessMs);

        // BackgroundPrefetch handles ranked warming after the active body is ready.
      } catch (error) {
        if (!cancelled) {
          if (scope === "session" && isAuthError(error)) {
            store.commit(events.cacheResetRequested({ requestedAt: Date.now() }));
            onMetrics({
              status: "error",
              message: "Session expired; local session cache cleared",
              eventCount: 1,
            });
            return;
          }
          if (cachedManifest) {
            onMetrics({
              status: navigator.onLine ? "ready" : "offline",
              message: navigator.onLine
                ? "Refresh failed; using cached manifest"
                : "Offline: using local cache",
            });
            scheduleRefresh(MANIFEST_RETRY_MS);
          } else {
            onMetrics({
              status: navigator.onLine ? "error" : "offline",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [client, fetchSlug, networkTick, onMetrics, readCachedManifest, scope, store]);

  useEffect(() => {
    // The current HTTP response already supplied this body. A fresh manifest
    // still reconciles updates/removals through the normal fetch path above.
    if (hasBootstrappedPage(store, currentSlug)) return;
    const state = store.query(siteState$) as SiteStateRow | null;
    const indexedPage = store.query(pageIndexBySlug$(currentSlug)) as PageIndexRow | null;
    const page = indexedPage
        ? {
            slug: indexedPage.slug,
            title: indexedPage.title,
            tags: parseJsonArray<string>(indexedPage.tagsJson),
            description: indexedPage.description,
            contentHash: indexedPage.contentHash,
            sensitive: indexedPage.sensitive,
            size: indexedPage.size,
          }
        : undefined;
    if (page) {
      void fetchSlug(currentSlug, page).catch(() => undefined);
      return;
    }

    if (state?.lastValidatedAt) {
      const cached = store.query(pageContentBySlug$(currentSlug)) as PageContentRow | null;
      if (cached?.contentStatus !== "missing") {
        store.commit(
          events.pageContentMissing({
            slug: currentSlug,
            contentHash: null,
            missingAt: Date.now(),
          }),
        );
        onMetrics({ eventCount: 1 });
      }
    } else {
      // The body endpoint independently enforces the gate and access rules and
      // includes its metadata. A cold reader need not wait for the entire site
      // manifest before requesting the one document the user asked to read.
      void fetchSlug(currentSlug).catch(() => undefined);
    }
  }, [currentSlug, fetchSlug, onMetrics, store]);

  useEffect(() => {
    const onRetryPage = () => {
      const manifest = manifestRef.current;
      const page = manifest?.pages.find((item) => item.slug === currentSlug);
      if (!page) {
        onMetrics({ status: "syncing", message: "Refreshing manifest before retry" });
        forceValidationRef.current = true;
        setNetworkTick((value) => value + 1);
        return;
      }

      onMetrics({ status: "syncing", message: `Retrying ${currentSlug}`, failedBodySlug: null });
      void fetchSlug(currentSlug, page).catch(() => undefined);
    };

    window.addEventListener(RETRY_PAGE_EVENT, onRetryPage);
    return () => window.removeEventListener(RETRY_PAGE_EVENT, onRetryPage);
  }, [currentSlug, fetchSlug, onMetrics]);

  useEffect(() => {
    if (currentSlug !== "index") rememberSlug(currentSlug);
  }, [currentSlug]);

  return <BackgroundPrefetch onMetrics={onMetrics} isForegroundBusy={isForegroundBusy} />;
}
