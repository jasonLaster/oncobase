import {
  WIKI_MANIFEST_SCHEMA_VERSION,
  type CompactFileNode,
  type createWikiContentClient,
  type WikiManifest,
  type WikiScope,
  type WikiManifestPage,
  type WikiManifestValidation,
} from "@oncobase/wiki-content";
import {
  assets$,
  fileTree$,
  pageContentBySlug$,
  pageIndex$,
  pageIndexBySlug$,
  siteState$,
} from "../livestore/queries";
import type { Store } from "@livestore/livestore";
import { events } from "../livestore/schema";
import { manifestToEvent, pageToEvent } from "../livestore/wiki-events";
import { syncErrorReason } from "../reader-telemetry";
import type { AssetIndexRow, MetricsPatch, PageContentRow, PageIndexRow, SiteStateRow } from "../types";
import { byteSize, isAuthError, normalizeFetchedPageSlug, parseJsonArray, storageSnapshot as readStorageSnapshot } from "../wiki-utils";
import {
  announcesManifestCheck,
  MANIFEST_FRESH_MS,
  nextManifestCheckDelay,
  nextManifestRetryDelay,
  timerMayCheck,
  type ManifestCheckReason,
} from "./manifest-poll-policy";
import { isStoredBodyCurrent } from "./prefetch-policy";
import { clearStartupSnapshot as clearStartupCache } from "../bootstrap/reader-startup-cache";
import { cachedStartupStores, hasBootstrappedPage as hasBootstrappedPageIn } from "../bootstrap/seed-state";
import { readerOnline } from "./connectivity";
import { emit } from "../reader-bus";
import { setManifestReceivedBytes as setManifestBytes, setPageTransfer as setTransfer } from "./transfer-progress";

const CHECK_REASON_RANK: Record<ManifestCheckReason, number> = { timer: 0, attention: 1, load: 2, user: 3 };

/** The two LiveStore calls the controller makes. */
export type SyncStore = Pick<Store, "query" | "commit">;

/** Everything outside the controller. The browser-facing parts default to
 * the real ones; tests replace them to drive the clock and the network. */
export type SyncEnvironment = {
  store: SyncStore;
  client: Pick<ReturnType<typeof createWikiContentClient>, "fetchPages" | "validateManifest">;
  scope: WikiScope;
  onMetrics: (patch: MetricsPatch) => void;
} & Partial<SyncBrowser>;

type SyncBrowser = {
  /** The current HTTP response already supplied this slug's body. */
  hasBootstrappedPage: (slug: string) => boolean;
  /** The store was seeded from a startup snapshot that may be stale. */
  seededFromStartupCache: boolean;
  online: () => boolean;
  visibility: () => DocumentVisibilityState;
  /** Tells background prefetch to yield to a foreground request. */
  foregroundFetch: () => void;
  setPageTransfer: (transfer: { slug: string; receivedBytes: number } | null) => void;
  setManifestReceivedBytes: (bytes: number) => void;
  storageSnapshot: () => Promise<{ usage: number | null; quota: number | null; pressure: NonNullable<MetricsPatch["storagePressure"]> }>;
  clearStartupSnapshot: () => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  now: () => number;
  /** Elapsed-time clock for sync durations. */
  elapsed: () => number;
};

/**
 * Reader sync for one store and scope: the manifest check loop and the
 * current route's body. Plain functions over local state, so it can be tested without React;
 * `WikiSync` creates one per store/scope/client and forwards route changes
 * and window events to it.
 *
 * Manifest checks are requested with a reason and run once per task, so a
 * burst of requests (online + visible, say) becomes one check that keeps the
 * strongest reason. Starting a check cancels the previous one's continuation
 * and its timer; a request already on the wire for the same hash is reused.
 */
export function createSyncController(env: SyncEnvironment, initialSlug: string) {
  // Locals, not property reads: they minify (StoreHost is budgeted).
  const {
    store, client, scope, onMetrics,
    hasBootstrappedPage = (slug: string) => hasBootstrappedPageIn(store as Store, slug),
    seededFromStartupCache = cachedStartupStores.has(store as Store),
    online: isOnline = readerOnline,
    visibility = () => document.visibilityState,
    foregroundFetch = () => emit("foreground-fetch"),
    setPageTransfer = setTransfer,
    setManifestReceivedBytes = setManifestBytes,
    storageSnapshot = readStorageSnapshot,
    clearStartupSnapshot = clearStartupCache,
    setTimeout: later = (callback: () => void, ms: number) => window.setTimeout(callback, ms),
    clearTimeout: cancelLater = (id: number) => window.clearTimeout(id),
    now = Date.now,
    elapsed = () => performance.now(),
  } = env;
  let currentSlug = initialSlug;
  let manifest: WikiManifest | null = null;
  /** The HTTP page can be newer than a recently cached navigation manifest. */
  let forceValidation = hasBootstrappedPage(initialSlug) || seededFromStartupCache;
  let navigationPending = false;
  let validationInFlight: { key: string; promise: Promise<WikiManifestValidation>; controller: AbortController } | null = null;
  let manifestFailures = 0;
  let pendingCheckReason: ManifestCheckReason | null = null;
  let unchangedChecks = 0;
  let checkedOnce = false;
  const inFlight = new Map<string, AbortController>();
  let generation = 0;
  let refreshTimer: number | undefined;
  let resumeTimer: number | undefined;
  let checkQueued = false;
  let disposed = false;

  /** The first manifest check and the current route's body. */
  function start() {
    runCheck();
    syncRoute();
  }

  function dispose() {
    disposed = true;
    generation++;
    if (refreshTimer !== undefined) cancelLater(refreshTimer);
    if (resumeTimer !== undefined) cancelLater(resumeTimer);
    validationInFlight?.controller.abort();
    validationInFlight = null;
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
  }

  /** Background prefetch waits while the reader has its own request open. */
  function isForegroundBusy() {
    return inFlight.size > 0 || validationInFlight !== null;
  }

  /** The route changed. Reading is attention: it restores the base cadence and
   * checks right away when the manifest is older than its freshness window. */
  function setRoute(slug: string) {
    if (disposed || slug === currentSlug) return;
    currentSlug = slug;
    unchangedChecks = 0;
    const state = store.query(siteState$) as SiteStateRow | null;
    if (!validationInFlight && state?.lastValidatedAt && now() - state.lastValidatedAt >= MANIFEST_FRESH_MS[scope]) {
      requestManifestCheck("attention");
    }
    syncRoute();
  }

  function requestManifestCheck(reason: ManifestCheckReason) {
    if (disposed) return;
    const pending = pendingCheckReason;
    if (!pending || CHECK_REASON_RANK[reason] > CHECK_REASON_RANK[pending]) pendingCheckReason = reason;
    if (checkQueued) return;
    checkQueued = true;
    queueMicrotask(() => {
      checkQueued = false;
      if (!disposed) runCheck();
    });
  }

  /** The user asked for fresh data: drop any check in flight and revalidate. */
  function refreshManifest() {
    validationInFlight?.controller.abort();
    validationInFlight = null;
    forceValidation = true;
    requestManifestCheck("user");
  }

  /** Retry the current page. The page endpoint authorizes independently, so a
   * failed or empty manifest must not turn Retry into a page-list waterfall. */
  function retryPage() {
    if (disposed) return;
    const slug = currentSlug;
    const page = manifest?.pages.find((item) => item.slug === slug);
    if (!page) {
      onMetrics({ status: "syncing", navigationFreshness: "checking", message: "Refreshing manifest before retry" });
      forceValidation = true;
      requestManifestCheck("user");
    }
    onMetrics({ status: "syncing", message: `Retrying ${slug}`, failedBodySlug: null });
    void fetchSlug(slug, page, true).catch(() => undefined);
  }

  function online() {
    requestManifestCheck("attention");
    syncRoute();
  }

  function visibilityChanged() {
    if (visibility() === "visible") requestManifestCheck("attention");
  }

  /** The document may be leaving. Pause manifest imports until it either
   * leaves or comes back; a canceled navigation must not leave the reader
   * paused, so resume on its own after a second. */
  function departing() {
    navigationPending = true;
    if (resumeTimer !== undefined) cancelLater(resumeTimer);
    resumeTimer = later(() => resumed(), 1000);
  }

  function resumed() {
    if (resumeTimer !== undefined) cancelLater(resumeTimer);
    resumeTimer = undefined;
    if (!navigationPending) return;
    navigationPending = false;
    forceValidation = true;
    requestManifestCheck("attention");
  }

  function readCachedManifest(): WikiManifest | null {
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
      pages: pages.map(indexRowToPage),
      assets: assets.map((asset) => ({ ...asset })),
    };
  }

  /** Abort other routes' bodies and make sure the current one is loading. */
  function syncRoute() {
    const slug = currentSlug;
    for (const [key, controller] of inFlight) {
      if (key !== `${scope}:${slug}`) controller.abort();
    }
    // The current HTTP response already supplied this body. A fresh manifest
    // still reconciles updates and removals through the manifest check.
    if (hasBootstrappedPage(slug)) return;
    const state = store.query(siteState$) as SiteStateRow | null;
    const indexed = store.query(pageIndexBySlug$(slug)) as PageIndexRow | null;
    if (indexed) {
      void fetchSlug(slug, indexRowToPage(indexed), seededFromStartupCache).catch(() => undefined);
      return;
    }
    if (state?.lastValidatedAt) {
      const cached = store.query(pageContentBySlug$(slug)) as PageContentRow | null;
      if (cached?.contentStatus !== "missing") {
        store.commit(events.pageContentMissing({ slug, contentHash: null, missingAt: now() }));
        onMetrics({ eventCount: 1 });
      }
    } else {
      // The body endpoint enforces the gate and access rules itself and
      // includes the page's metadata. A cold reader need not wait for the
      // whole site manifest before asking for the one page the user opened.
      void fetchSlug(slug).catch(() => undefined);
    }
  }

  async function fetchSlug(slug: string, pageIndex?: WikiManifestPage, force = false) {
    const cacheKey = `${scope}:${slug}`;
    const existing = inFlight.get(cacheKey);
    if (existing && !force) return;
    existing?.abort();

    const cached = store.query(pageContentBySlug$(slug)) as PageContentRow | null;
    // P11: the manifest names each body by its hash. A stored body with the
    // listed hash is that body, however long ago it arrived. A publish changes
    // the hash (and so the URL below); the manifest check delivers it.
    if (!force && isStoredBodyCurrent(cached, pageIndex)) return;

    const controller = new AbortController();
    inFlight.set(cacheKey, controller);
    if (slug === currentSlug) {
      setPageTransfer({ slug, receivedBytes: 0 });
      onMetrics({ failedBodySlug: null });
    }
    foregroundFetch();
    try {
      // Forced reads (retry, a startup snapshot) bypass the HTTP cache.
      const batch = await client.fetchPages({ slugs: [slug], signal: controller.signal,
        ...(force ? {} : { versions: [pageIndex?.contentHash] }),
        onProgress: receivedBytes => {
          if (!controller.signal.aborted && slug === currentSlug) setPageTransfer({ slug, receivedBytes });
        },
      });
      if (controller.signal.aborted) return;
      const page = normalizeFetchedPageSlug(slug, batch.pages);
      if (page) {
        store.commit(pageToEvent(page));
        onMetrics({ markdownBytes: page.size, eventCount: 1, ...(slug === currentSlug ? { failedBodySlug: null } : {}) });
        return;
      }
      const unavailable = batch.unavailable?.find((item) => item.slug === slug);
      if (unavailable) {
        store.commit(events.pageContentUnavailable({
          slug: unavailable.slug, title: unavailable.title, tags: unavailable.tags, contentHash: unavailable.contentHash,
          sensitive: unavailable.sensitive, size: unavailable.size, unavailableAt: now(),
        }));
        onMetrics({ eventCount: 1 });
        return;
      }
      store.commit(events.pageContentMissing({ slug, contentHash: pageIndex?.contentHash ?? null, missingAt: now() }));
      onMetrics({ eventCount: 1 });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isAuthError(error)) {
        clearStartupSnapshot();
        store.commit(events.cacheResetRequested({ requestedAt: now() }));
        onMetrics({ status: "error", errorReason: "auth", message: "Session expired; local session cache cleared", eventCount: 1, failedBodyFetches: 1 });
      } else if (!isOnline()) {
        // Keep the current page up; going online retries this route.
        onMetrics({ status: "offline", navigationFreshness: "offline", message: "Offline: using local cache", failedBodyFetches: 1 });
      } else {
        onMetrics({
          ...(slug === currentSlug
            ? { status: "error" as const, errorReason: syncErrorReason("body", error), message: `Failed to fetch markdown for ${slug}`, failedBodySlug: slug }
            : {}),
          failedBodyFetches: 1,
        });
      }
      throw error;
    } finally {
      if (inFlight.get(cacheKey) === controller) {
        inFlight.delete(cacheKey);
        if (slug === currentSlug) setPageTransfer(null);
      }
    }
  }

  /** One manifest check. A newer check supersedes this one's continuation. */
  function runCheck() {
    const mine = ++generation;
    if (refreshTimer !== undefined) cancelLater(refreshTimer);
    refreshTimer = undefined;
    void check(() => mine !== generation || disposed);
  }

  function scheduleRefresh(cancelled: () => boolean, delayMs: number) {
    // A check that resolves after it was superseded must not leave a timer.
    if (cancelled()) return;
    refreshTimer = later(
      // A hidden tab stops here. Becoming visible requests its own check.
      () => { if (timerMayCheck(visibility())) requestManifestCheck("timer"); },
      Math.max(0, delayMs),
    );
  }

  async function check(cancelled: () => boolean) {
    let requestController: AbortController | undefined;
    const cachedManifest = manifest?.scope === scope ? manifest : readCachedManifest();
    manifest = cachedManifest;
    const cachedState = store.query(siteState$) as SiteStateRow | null;
    const checkedAt = now();
    const forced = forceValidation;
    forceValidation = false;
    const reason: ManifestCheckReason = !checkedOnce ? "load" : pendingCheckReason ?? "attention";
    pendingCheckReason = null;
    checkedOnce = true;
    if (reason !== "timer") unchangedChecks = 0;
    const freshnessMs = MANIFEST_FRESH_MS[scope];
    const cacheAge = cachedState ? checkedAt - cachedState.lastValidatedAt : Number.POSITIVE_INFINITY;

    if (cachedManifest && !forced && cacheAge < freshnessMs) {
      onMetrics({
        status: "ready",
        navigationFreshness: "current",
        message: `Using fresh manifest ${cachedManifest.manifestHash.slice(0, 8)}`,
        manifestBytes: cachedState?.manifestSize ?? 0,
      });
      scheduleRefresh(cancelled, freshnessMs - cacheAge);
      return;
    }

    // Always try: navigator.onLine can be false while the network works, and
    // a real outage fails fast into the offline handling below.
    const syncStart = elapsed();
    setManifestReceivedBytes(0);
    // Unattended checks stay silent: flipping the status every interval made
    // the live region announce "Checking…" to screen readers all day.
    if (announcesManifestCheck(reason, Boolean(cachedManifest))) {
      onMetrics({ status: "syncing", navigationFreshness: "checking", message: cachedManifest ? "Checking for wiki updates" : "Loading manifest" });
    }
    try {
      const validationKey = `${scope}:${cachedManifest?.manifestHash ?? "empty"}`;
      const reused = validationInFlight?.key === validationKey ? validationInFlight : null;
      requestController = reused?.controller ?? new AbortController();
      const signal = requestController.signal;
      const validationPromise = reused?.promise ?? client.validateManifest(cachedManifest?.manifestHash,
        receivedBytes => { if (!signal.aborted) setManifestReceivedBytes(receivedBytes); },
        signal);
      validationInFlight = { key: validationKey, promise: validationPromise, controller: requestController };
      foregroundFetch();
      let validation: WikiManifestValidation;
      try {
        validation = await validationPromise;
      } finally {
        if (validationInFlight?.promise === validationPromise) validationInFlight = null;
      }
      if (cancelled()) return;
      const validatedAt = now();
      const hasCompleteSnapshot = Boolean(cachedManifest) && (cachedState?.lastValidatedAt ?? 0) > 0;
      if (validation.status === "unchanged" && cachedManifest) {
        if (validation.partial) {
          onMetrics({
            status: "ready",
            navigationFreshness: "saved",
            message: hasCompleteSnapshot ? "Partial refresh ignored; using complete cached manifest" : "Provisional manifest loaded; retrying full manifest",
            manifestBytes: cachedState?.manifestSize ?? 0,
          });
          scheduleRefresh(cancelled, nextManifestRetryDelay(manifestFailures++));
          return;
        }
        manifestFailures = 0;
        if (reason === "timer") unchangedChecks += 1;
        store.commit(events.manifestValidated({ manifestHash: cachedManifest.manifestHash, validatedAt }));
        onMetrics({
          status: "ready",
          navigationFreshness: "current",
          message: `Manifest ${cachedManifest.manifestHash.slice(0, 8)} is current`,
          manifestBytes: cachedState?.manifestSize ?? 0,
          eventCount: 1,
          lastSyncMs: elapsed() - syncStart,
        });
        scheduleRefresh(cancelled, nextManifestCheckDelay(scope, unchangedChecks));
        return;
      }

      if (validation.status !== "modified") throw new Error("Manifest validation returned no replacement snapshot");
      if (validation.partial && hasCompleteSnapshot) {
        onMetrics({ status: "ready", navigationFreshness: "saved", message: "Partial refresh ignored; using complete cached manifest", manifestBytes: cachedState?.manifestSize ?? 0 });
        scheduleRefresh(cancelled, nextManifestRetryDelay(manifestFailures++));
        return;
      }
      const next = validation.manifest;
      // Leave the fetch promise's microtask checkpoint before the atomic
      // import, so a queued navigation runs its departure hook instead of
      // waiting on work for a document the reader is leaving.
      await new Promise<void>(resolve => later(resolve, 0));
      if (cancelled() || navigationPending) return;
      unchangedChecks = 0;
      if (!validation.partial) manifestFailures = 0;
      manifest = next;
      // A manifest is one LiveStore event, so its tree and indexes replace the
      // prior snapshot in the materializer's single transaction.
      if (validation.partial) {
        store.commit(manifestToEvent(next, validatedAt), events.manifestMarkedProvisional({ manifestHash: next.manifestHash }));
      } else {
        store.commit(manifestToEvent(next, validatedAt));
      }
      const activeSlug = currentSlug;
      void fetchSlug(activeSlug, next.pages.find((page) => page.slug === activeSlug)).catch(() => undefined);
      const storage = await storageSnapshot();
      if (cancelled()) return;
      onMetrics({
        status: "ready",
        navigationFreshness: validation.partial ? "saved" : "current",
        message: validation.partial ? "Provisional manifest loaded; retrying full manifest" : `Manifest ${next.manifestHash.slice(0, 8)} loaded`,
        manifestBytes: byteSize(JSON.stringify(next)),
        eventCount: 1,
        lastSyncMs: elapsed() - syncStart,
        opfsBytes: storage.usage,
        storageQuotaBytes: storage.quota,
        storagePressure: storage.pressure,
      });
      scheduleRefresh(cancelled, validation.partial ? nextManifestRetryDelay(manifestFailures++) : freshnessMs);
      // Background prefetch warms ranked pages after the active body is ready.
    } catch (error) {
      if (requestController?.signal.aborted || cancelled()) return;
      if (isAuthError(error)) {
        clearStartupSnapshot();
        store.commit(events.cacheResetRequested({ requestedAt: now() }));
        onMetrics({ status: "error", errorReason: "auth", navigationFreshness: "saved", message: "Session expired; local session cache cleared", eventCount: 1 });
        return;
      }
      const online = isOnline();
      if (cachedManifest) {
        onMetrics({
          status: online ? "ready" : "offline",
          navigationFreshness: online ? "saved" : "offline",
          message: online ? "Refresh failed; using cached manifest" : "Offline: using local cache",
        });
        scheduleRefresh(cancelled, nextManifestRetryDelay(manifestFailures++));
      } else {
        onMetrics({
          status: online ? "error" : "offline",
          errorReason: syncErrorReason("manifest", error),
          navigationFreshness: online ? "saved" : "offline",
          message: error instanceof Error ? error.message : String(error),
        });
        // A brief lost connection must not strand an empty reader until
        // reload. Keep one bounded retry timer, also resumed by online.
        scheduleRefresh(cancelled, Math.min(30_000, 5_000 * 2 ** Math.min(manifestFailures++, 3)));
      }
    }
  }

  return { start, dispose, isForegroundBusy, setRoute, requestManifestCheck, refreshManifest, retryPage, online, visibilityChanged, departing, resumed, fetchSlug };
}

export type SyncController = ReturnType<typeof createSyncController>;

function indexRowToPage(page: PageIndexRow): WikiManifestPage {
  return {
    slug: page.slug,
    title: page.title,
    tags: parseJsonArray<string>(page.tagsJson),
    description: page.description,
    contentHash: page.contentHash,
    sensitive: page.sensitive,
    size: page.size,
  };
}
