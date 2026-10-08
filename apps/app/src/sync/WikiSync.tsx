import { readerFetch, syncErrorReason } from "../reader-telemetry";
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
import { clearStartupSnapshot } from "../bootstrap/reader-startup-cache";
import { hasBootstrappedPage, cachedStartupStores } from "../bootstrap/seed-state";
export { WARM_CACHE_EVENT } from "./BackgroundPrefetch";
import { RETRY_PAGE_EVENT, REFRESH_MANIFEST_EVENT } from "./events";
import { setManifestReceivedBytes, setPageTransfer } from "./transfer-progress";
import { readerOnline } from "./connectivity";
export { RETRY_PAGE_EVENT, REFRESH_MANIFEST_EVENT } from "./events";

const MANIFEST_FRESH_MS: Record<WikiScope, number> = {
  public: 60_000,
  session: 30_000,
};
const MANIFEST_RETRY_MS = 30_000;

/** `background={false}` syncs the current route only (manifest and body), for a
 * store that is preparing to replace a presentation and not yet visible. */
export function WikiSync({ onMetrics, background = true }: { onMetrics: (patch: MetricsPatch) => void; background?: boolean }) {
  const { store } = useStore();
  const scope = useWikiScope();
  const location = useLocation();
  const currentSlug = contentSlugFromRouteSlug(slugFromPath(location.pathname));
  const [networkTick, setNetworkTick] = useState(0);
  const [pageRetryTick, setPageRetryTick] = useState(0);
  const manifestRef = useRef<WikiManifest | null>(null);
  const currentSlugRef = useRef(currentSlug);
  // The HTTP page can be newer than a recently cached navigation manifest.
  const forceValidationRef = useRef(hasBootstrappedPage(store, currentSlug) || cachedStartupStores.has(store));
  const navigationPending = useRef(false);
  const validationInFlight = useRef<{
    key: string;
    promise: Promise<WikiManifestValidation>;
    controller: AbortController;
  } | null>(null);
  const manifestFailures = useRef(0);
  const inFlight = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    validationInFlight.current?.controller.abort();
    validationInFlight.current = null;
    for (const controller of inFlight.current.values()) controller.abort();
    inFlight.current.clear();
  }, [store]);
  const isForegroundBusy = useCallback(
    () => inFlight.current.size > 0 || validationInFlight.current !== null,
    [],
  );
  useEffect(() => {
    currentSlugRef.current = currentSlug;
  }, [currentSlug]);
  useEffect(() => {
    let resumeTimer: number | undefined;
    const resume = () => {
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
      if (!navigationPending.current) return;
      navigationPending.current = false;
      forceValidationRef.current = true;
      setNetworkTick(value => value + 1);
    };
    const departing = () => {
      navigationPending.current = true;
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
      // A canceled/failed navigation must not leave the current reader paused.
      // Successful navigation destroys this timer along with the old document.
      resumeTimer = window.setTimeout(resume, 1000);
    };
    window.addEventListener("beforeunload", departing);
    window.addEventListener("pageshow", resume);
    return () => {
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
      window.removeEventListener("beforeunload", departing);
      window.removeEventListener("pageshow", resume);
    };
  }, []);
  const client = useMemo(() => {
    const baseUrl = import.meta.env.VITE_WIKI_API_ORIGIN ?? "";
    return createWikiContentClient({ fetch: readerFetch,
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
    async (slug: string, pageIndex?: WikiManifestPage, force = false) => {
      const cacheKey = `${scope}:${slug}`;
      const existing = inFlight.current.get(cacheKey);
      if (existing && !force) return;
      existing?.abort();

      const cached = store.query(pageContentBySlug$(slug)) as PageContentRow | null;
      if (
        !force && cached?.content &&
        pageIndex &&
        cached.contentHash === pageIndex.contentHash &&
        cached.contentStatus === "fresh" &&
        Date.now() - cached.fetchedAt < PREFETCH_LIMITS.revalidateMs
      ) {
        return;
      }

      const controller = new AbortController();
      inFlight.current.set(cacheKey, controller);
      if (slug === currentSlugRef.current) {
        setPageTransfer({ slug, receivedBytes: 0 });
        onMetrics({ failedBodySlug: null });
      }
      window.dispatchEvent(new Event(FOREGROUND_FETCH_EVENT));
      try {
        const batch = await client.fetchPages({ slugs: [slug], signal: controller.signal,
          onProgress: receivedBytes => {
            if (!controller.signal.aborted && slug === currentSlugRef.current) setPageTransfer({ slug, receivedBytes });
          },
        });
        if (controller.signal.aborted) return;
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
        if (controller.signal.aborted) return;
        if (isAuthError(error)) {
          clearStartupSnapshot();
          store.commit(events.cacheResetRequested({ requestedAt: Date.now() }));
          onMetrics({
            status: "error",
            errorReason: "auth",
            message: "Session expired; local session cache cleared",
            eventCount: 1,
            failedBodyFetches: 1,
          });
        } else if (!readerOnline()) {
          // Keep the current page up; the online listener retries this route.
          onMetrics({ status: "offline", navigationFreshness: "offline", message: "Offline: using local cache", failedBodyFetches: 1 });
        } else {
          onMetrics({
            ...(slug === currentSlugRef.current
              ? {
                  status: "error" as const,
                  errorReason: syncErrorReason("body", error),
                  message: `Failed to fetch markdown for ${slug}`,
                  failedBodySlug: slug,
                }
              : {}),
            failedBodyFetches: 1,
          });
        }
        throw error;
      } finally {
        if (inFlight.current.get(cacheKey) === controller) {
          inFlight.current.delete(cacheKey);
          if (slug === currentSlugRef.current) setPageTransfer(null);
        }
      }
    },
    [client, onMetrics, scope, store],
  );

  useEffect(() => {
    const onOnline = () => { setNetworkTick(value => value + 1); setPageRetryTick(value => value + 1); };
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
      validationInFlight.current?.controller.abort();
      validationInFlight.current = null;
      forceValidationRef.current = true;
      setNetworkTick((value) => value + 1);
    };
    window.addEventListener(REFRESH_MANIFEST_EVENT, onRefreshManifest);
    return () => window.removeEventListener(REFRESH_MANIFEST_EVENT, onRefreshManifest);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;
    let requestController: AbortController | undefined;

    const scheduleRefresh = (delayMs: number) => {
      // A run that resolves after cleanup must not leave a timer behind.
      if (cancelled) return;
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
          navigationFreshness: "current",
          message: `Using fresh manifest ${cachedManifest.manifestHash.slice(0, 8)}`,
          manifestBytes: cachedState?.manifestSize ?? 0,
        });
        scheduleRefresh(freshnessMs - cacheAge);
        return;
      }

      // Always try: navigator.onLine can be false while the network works, and
      // a real outage fails fast into the offline handling below.
      const syncStart = performance.now();
      setManifestReceivedBytes(0);
      onMetrics({
        status: "syncing",
        navigationFreshness: "checking",
        message: cachedManifest ? "Checking for wiki updates" : "Loading manifest",
      });
      try {
        const validationKey = `${scope}:${cachedManifest?.manifestHash ?? "empty"}`;
        requestController = validationInFlight.current?.key === validationKey
          ? validationInFlight.current.controller : new AbortController();
        const validationPromise =
          validationInFlight.current?.key === validationKey
            ? validationInFlight.current.promise
            : client.validateManifest(cachedManifest?.manifestHash,
              receivedBytes => { if (!requestController?.signal.aborted) setManifestReceivedBytes(receivedBytes); },
              requestController.signal);
        validationInFlight.current = {
          key: validationKey,
          promise: validationPromise,
          controller: requestController,
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
        manifestFailures.current = 0;
        const validatedAt = Date.now();
        const hasCompleteSnapshot =
          Boolean(cachedManifest) && (cachedState?.lastValidatedAt ?? 0) > 0;
        if (validation.status === "unchanged" && cachedManifest) {
          if (validation.partial) {
            onMetrics({
              status: "ready",
              navigationFreshness: "saved",
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
            navigationFreshness: "current",
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
            navigationFreshness: "saved",
            message: "Partial refresh ignored; using complete cached manifest",
            manifestBytes: cachedState?.manifestSize ?? 0,
          });
          scheduleRefresh(MANIFEST_RETRY_MS);
          return;
        }
        const manifest = validation.manifest;
        // Leave the fetch promise's microtask checkpoint before starting the
        // atomic import. This lets a queued navigation run its departure hook
        // instead of being blocked by work for a document the reader is leaving.
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        if (cancelled || navigationPending.current) return;
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
        if (cancelled) return;
        onMetrics({
          status: "ready",
          navigationFreshness: validation.partial ? "saved" : "current",
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
        if (requestController?.signal.aborted) return;
        if (!cancelled) {
          if (isAuthError(error)) {
            clearStartupSnapshot();
            store.commit(events.cacheResetRequested({ requestedAt: Date.now() }));
            onMetrics({
              status: "error",
              errorReason: "auth",
              navigationFreshness: "saved",
              message: "Session expired; local session cache cleared",
              eventCount: 1,
            });
            return;
          }
          if (cachedManifest) {
            onMetrics({
              status: readerOnline() ? "ready" : "offline",
              navigationFreshness: readerOnline() ? "saved" : "offline",
              message: readerOnline()
                ? "Refresh failed; using cached manifest"
                : "Offline: using local cache",
            });
            scheduleRefresh(MANIFEST_RETRY_MS);
          } else {
            onMetrics({
              status: readerOnline() ? "error" : "offline",
              errorReason: syncErrorReason("manifest", error),
              navigationFreshness: readerOnline() ? "saved" : "offline",
              message: error instanceof Error ? error.message : String(error),
            });
            // A brief lost connection must not strand an empty reader until
            // reload. Keep one bounded retry timer, also resumed by online.
            scheduleRefresh(Math.min(30_000, 5_000 * 2 ** Math.min(manifestFailures.current++, 3)));
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
    for (const [key, controller] of inFlight.current) {
      if (key !== `${scope}:${currentSlug}`) controller.abort();
    }
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
      void fetchSlug(currentSlug, page, cachedStartupStores.has(store)).catch(() => undefined);
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
  }, [currentSlug, fetchSlug, pageRetryTick, onMetrics, scope, store]);

  useEffect(() => {
    const onRetryPage = () => {
      const manifest = manifestRef.current;
      const page = manifest?.pages.find((item) => item.slug === currentSlug);
      if (!page) {
        onMetrics({ status: "syncing", navigationFreshness: "checking", message: "Refreshing manifest before retry" });
        forceValidationRef.current = true;
        setNetworkTick((value) => value + 1);
      }

      onMetrics({ status: "syncing", message: `Retrying ${currentSlug}`, failedBodySlug: null });
      // The page endpoint authorizes independently. Even an empty or failed
      // manifest must not turn Retry into another page-list waterfall.
      void fetchSlug(currentSlug, page, true).catch(() => undefined);
    };

    window.addEventListener(RETRY_PAGE_EVENT, onRetryPage);
    return () => window.removeEventListener(RETRY_PAGE_EVENT, onRetryPage);
  }, [currentSlug, fetchSlug, onMetrics]);

  useEffect(() => {
    if (currentSlug !== "index") rememberSlug(currentSlug);
  }, [currentSlug]);

  return background ? <BackgroundPrefetch onMetrics={onMetrics} isForegroundBusy={isForegroundBusy} /> : null;
}
