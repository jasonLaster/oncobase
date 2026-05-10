import { useStore } from "@livestore/react";
import {
  createWikiContentClient,
  expandCompactFileTree,
  flattenFileTree,
  type WikiManifest,
  type WikiManifestPage,
  type WikiScope,
} from "@diana-tnbc/wiki-content";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { pageContentBySlug$ } from "../livestore/queries";
import { events } from "../livestore/schema";
import type { MetricsPatch, PageContentRow } from "../types";
import { useWikiScope } from "../wiki-context";
import {
  byteSize,
  isAuthError,
  manifestToEvent,
  normalizeFetchedPageSlug,
  pageToEvent,
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
  const currentSlug = slugFromPath(location.pathname);
  const [networkTick, setNetworkTick] = useState(0);
  const manifestRef = useRef<WikiManifest | null>(null);
  const inFlight = useRef(new Set<string>());
  const client = useMemo(() => {
    const baseUrl = import.meta.env.VITE_WIKI_API_ORIGIN ?? "";
    return createWikiContentClient({
      scope,
      baseUrl,
      credentials: baseUrl ? "include" : "same-origin",
    });
  }, [scope]);

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
            ...(slug === currentSlug
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
    [client, currentSlug, onMetrics, scope, store],
  );

  useEffect(() => {
    const onOnline = () => setNetworkTick((value) => value + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!navigator.onLine) {
        onMetrics({ status: "offline", message: "Offline: using local cache" });
        return;
      }

      const syncStart = performance.now();
      onMetrics({ status: "syncing", message: "Refreshing manifest" });
      try {
        const manifest = await client.fetchManifest();
        if (cancelled) return;
        manifestRef.current = manifest;
        const receivedAt = Date.now();
        store.commit(manifestToEvent(manifest, receivedAt));
        const { manifestBySlug, queue, queuedBytes } = buildEagerQueue(currentSlug, manifest);
        const currentPage = manifestBySlug.get(currentSlug);
        const storage = await storageSnapshot();
        onMetrics({
          status: "ready",
          message: `Manifest ${manifest.manifestHash.slice(0, 8)} loaded`,
          manifestBytes: byteSize(JSON.stringify(manifest)),
          eventCount: 1,
          lastSyncMs: performance.now() - syncStart,
          opfsBytes: storage.usage,
          storageQuotaBytes: storage.quota,
          storagePressure: storage.pressure,
        });

        if (currentPage) {
          void fetchSlug(currentSlug, currentPage).catch(() => undefined);
        } else {
          store.commit(
            events.pageContentMissing({
              slug: currentSlug,
              contentHash: null,
              missingAt: Date.now(),
            }),
          );
          onMetrics({ eventCount: 1 });
        }

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
          onMetrics({
            status: navigator.onLine ? "error" : "offline",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [client, currentSlug, fetchSlug, networkTick, onMetrics, scope, store]);

  useEffect(() => {
    const manifest = manifestRef.current;
    if (!manifest) return;
    const page = manifest.pages.find((item) => item.slug === currentSlug);
    if (page) void fetchSlug(currentSlug, page).catch(() => undefined);
  }, [currentSlug, fetchSlug]);

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
