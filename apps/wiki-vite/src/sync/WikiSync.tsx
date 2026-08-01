import { useStore } from "@livestore/react";
import {
  createWikiContentClient,
  expandCompactFileTree,
  flattenFileTree,
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
  readRecentSlugs,
  rememberSlug,
  slugFromPath,
  storageSnapshot,
} from "../wiki-utils";

const EAGER_FETCH_BUDGET = {
  batchSize: 4,
  maxBytes: 2 * 1024 * 1024,
  maxPages: 80,
  maxRetries: 2,
};

export const WARM_CACHE_EVENT = "wiki-vite:warm-cache";
export const RETRY_PAGE_EVENT = "wiki-vite:retry-page";
export const REFRESH_MANIFEST_EVENT = "wiki-vite:refresh-manifest";

const MANIFEST_FRESH_MS: Record<WikiScope, number> = {
  public: 60_000,
  session: 30_000,
};
const MANIFEST_RETRY_MS = 30_000;

function shouldFetchInBackground() {
  if (!navigator.onLine) return false;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean };
    }
  ).connection;
  return connection?.saveData !== true;
}

function buildEagerQueue(currentSlug: string, manifest: WikiManifest) {
  const manifestBySlug = new Map(manifest.pages.map((page) => [page.slug, page]));
  const treeSlugs = flattenFileTree(expandCompactFileTree(manifest.compactTree))
    .filter((node) => node.type === "file")
    .map((node) => node.slug);
  const recent = readRecentSlugs();
  const priority = [...treeSlugs.slice(0, 20), ...recent];
  const candidates = [...new Set([...priority, ...manifest.pages.map((page) => page.slug)])]
    .filter((slug) => slug !== currentSlug && manifestBySlug.has(slug));

  let queuedBytes = 0;
  const queue: string[] = [];
  for (const slug of candidates) {
    const page = manifestBySlug.get(slug);
    if (!page) continue;
    if (queue.length >= EAGER_FETCH_BUDGET.maxPages) break;
    if (queuedBytes + page.size > EAGER_FETCH_BUDGET.maxBytes && slug !== currentSlug) {
      continue;
    }
    queuedBytes += page.size;
    queue.push(slug);
  }

  return { manifestBySlug, queue, queuedBytes };
}

function scheduleIdle(callback: () => void, timeout: number, fallbackDelay: number) {
  const requestIdleCallback = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback, { timeout });
    return;
  }

  globalThis.setTimeout(callback, fallbackDelay);
}

function scheduleEagerFetch({
  fetchSlug,
  manifestBySlug,
  onMetrics,
  queue,
}: {
  fetchSlug: (slug: string, page: WikiManifestPage) => Promise<void>;
  manifestBySlug: Map<string, WikiManifestPage>;
  onMetrics: (patch: MetricsPatch) => void;
  queue: string[];
}) {
  let index = 0;
  const attempts = new Map<string, number>();

  const runBatch = () => {
    if (!shouldFetchInBackground()) {
      onMetrics({ status: "offline", message: "Background fetch paused" });
      return;
    }

    const next = queue.slice(index, index + EAGER_FETCH_BUDGET.batchSize);
    index += next.length;

    void Promise.all(
      next.map(async (slug) => {
        const page = manifestBySlug.get(slug);
        if (!page) return;
        try {
          await fetchSlug(slug, page);
        } catch {
          const nextAttempt = (attempts.get(slug) ?? 0) + 1;
          attempts.set(slug, nextAttempt);
          if (nextAttempt <= EAGER_FETCH_BUDGET.maxRetries) {
            queue.push(slug);
          }
        }
      }),
    ).finally(() => {
      if (index >= queue.length) return;
      const retryBackoff = attempts.size > 0 ? 1000 : 250;
      scheduleIdle(runBatch, 1500, retryBackoff);
    });
  };

  scheduleIdle(runBatch, 1000, 100);
}

export function WikiSync({ onMetrics }: { onMetrics: (patch: MetricsPatch) => void }) {
  const { store } = useStore();
  const scope = useWikiScope();
  const location = useLocation();
  const currentSlug = contentSlugFromRouteSlug(slugFromPath(location.pathname));
  const [networkTick, setNetworkTick] = useState(0);
  const manifestRef = useRef<WikiManifest | null>(null);
  const currentSlugRef = useRef(currentSlug);
  const forceValidationRef = useRef(false);
  const validationInFlight = useRef<{
    key: string;
    promise: Promise<WikiManifestValidation>;
  } | null>(null);
  const inFlight = useRef(new Set<string>());
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
        cached.contentStatus === "fresh"
      ) {
        return;
      }

      inFlight.current.add(cacheKey);
      try {
        const batch = await client.fetchPages({ slugs: [slug] });
        const page = normalizeFetchedPageSlug(slug, batch.pages);
        if (page) {
          store.commit(pageToEvent(page));
          onMetrics({
            markdownBytes: page.size,
            eventCount: 1,
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
        const { manifestBySlug, queue, queuedBytes } = buildEagerQueue(
          currentSlugRef.current,
          manifest,
        );
        const activeSlug = currentSlugRef.current;
        const activePage = manifestBySlug.get(activeSlug);
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

        if (validation.partial) return;

        if (shouldFetchInBackground()) {
          onMetrics({
            status: "ready",
            message: `Queued ${queue.length} pages (${Math.round(queuedBytes / 1024)} KB)`,
          });
          scheduleEagerFetch({ queue, manifestBySlug, fetchSlug, onMetrics });
        } else {
          onMetrics({ status: "offline", message: "Background fetch paused" });
        }
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
    const manifest = manifestRef.current;
    const indexedPage = (store.query(pageIndex$) as PageIndexRow[]).find(
      (item) => item.slug === currentSlug,
    );
    const page = manifest?.pages.find((item) => item.slug === currentSlug) ??
      (indexedPage
        ? {
            slug: indexedPage.slug,
            title: indexedPage.title,
            tags: parseJsonArray<string>(indexedPage.tagsJson),
            description: indexedPage.description,
            contentHash: indexedPage.contentHash,
            sensitive: indexedPage.sensitive,
            size: indexedPage.size,
          }
        : undefined);
    if (page) void fetchSlug(currentSlug, page).catch(() => undefined);
  }, [currentSlug, fetchSlug, store]);

  useEffect(() => {
    const onWarmCache = () => {
      const manifest = manifestRef.current;
      if (!manifest) {
        onMetrics({ status: "syncing", message: "Waiting for manifest before warming" });
        return;
      }

      const { manifestBySlug, queue, queuedBytes } = buildEagerQueue(currentSlug, manifest);
      onMetrics({
        status: "ready",
        message: `Warming ${queue.length} pages (${Math.round(queuedBytes / 1024)} KB)`,
      });
      scheduleEagerFetch({ queue, manifestBySlug, fetchSlug, onMetrics });
    };

    window.addEventListener(WARM_CACHE_EVENT, onWarmCache);
    return () => window.removeEventListener(WARM_CACHE_EVENT, onWarmCache);
  }, [currentSlug, fetchSlug, onMetrics]);

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

      onMetrics({ status: "syncing", message: `Retrying ${currentSlug}` });
      void fetchSlug(currentSlug, page).catch(() => undefined);
    };

    window.addEventListener(RETRY_PAGE_EVENT, onRetryPage);
    return () => window.removeEventListener(RETRY_PAGE_EVENT, onRetryPage);
  }, [currentSlug, fetchSlug, onMetrics]);

  useEffect(() => {
    if (currentSlug !== "index") rememberSlug(currentSlug);
  }, [currentSlug]);

  return null;
}
