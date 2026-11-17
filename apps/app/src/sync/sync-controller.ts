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
import { byteSize, isAuthError, normalizeFetchedPageSlug, parseJsonArray } from "../wiki-utils";
import {
  announcesManifestCheck,
  MANIFEST_FRESH_MS,
  nextManifestCheckDelay,
  nextManifestRetryDelay,
  timerMayCheck,
  type ManifestCheckReason,
} from "./manifest-poll-policy";
import { isStoredBodyCurrent } from "./prefetch-policy";

const CHECK_REASON_RANK: Record<ManifestCheckReason, number> = { timer: 0, attention: 1, load: 2, user: 3 };

/** The two LiveStore calls the controller makes. */
export type SyncStore = Pick<Store, "query" | "commit">;

/** Everything outside the controller, injected so tests can drive it. */
export type SyncEnvironment = {
  store: SyncStore;
  client: Pick<ReturnType<typeof createWikiContentClient>, "fetchPages" | "validateManifest">;
  scope: WikiScope;
  onMetrics: (patch: MetricsPatch) => void;
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
 * current route's body. A plain object so it can be tested without React;
 * `WikiSync` creates one per store/scope/client and forwards route changes
 * and window events to it.
 *
 * Manifest checks are requested with a reason and run once per task, so a
 * burst of requests (online + visible, say) becomes one check that keeps the
 * strongest reason. Starting a check cancels the previous one's continuation
 * and its timer; a request already on the wire for the same hash is reused.
 */
export class SyncController {
  private currentSlug: string;
  private manifest: WikiManifest | null = null;
  /** The HTTP page can be newer than a recently cached navigation manifest. */
  private forceValidation: boolean;
  private navigationPending = false;
  private validationInFlight: { key: string; promise: Promise<WikiManifestValidation>; controller: AbortController } | null = null;
  private manifestFailures = 0;
  private pendingCheckReason: ManifestCheckReason | null = null;
  private unchangedChecks = 0;
  private checkedOnce = false;
  private readonly inFlight = new Map<string, AbortController>();
  private generation = 0;
  private refreshTimer: number | undefined;
  private resumeTimer: number | undefined;
  private checkQueued = false;
  private disposed = false;

  constructor(private readonly env: SyncEnvironment, initialSlug: string) {
    this.currentSlug = initialSlug;
    this.forceValidation = env.hasBootstrappedPage(initialSlug) || env.seededFromStartupCache;
  }

  /** The first manifest check and the current route's body. */
  start() {
    this.runCheck();
    this.syncRoute();
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    if (this.refreshTimer !== undefined) this.env.clearTimeout(this.refreshTimer);
    if (this.resumeTimer !== undefined) this.env.clearTimeout(this.resumeTimer);
    this.validationInFlight?.controller.abort();
    this.validationInFlight = null;
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }

  /** Background prefetch waits while the reader has its own request open. */
  isForegroundBusy() {
    return this.inFlight.size > 0 || this.validationInFlight !== null;
  }

  /** The route changed. Reading is attention: it restores the base cadence and
   * checks right away when the manifest is older than its freshness window. */
  setRoute(slug: string) {
    if (this.disposed || slug === this.currentSlug) return;
    this.currentSlug = slug;
    this.unchangedChecks = 0;
    const state = this.env.store.query(siteState$) as SiteStateRow | null;
    if (!this.validationInFlight && state?.lastValidatedAt && this.env.now() - state.lastValidatedAt >= MANIFEST_FRESH_MS[this.env.scope]) {
      this.requestManifestCheck("attention");
    }
    this.syncRoute();
  }

  requestManifestCheck(reason: ManifestCheckReason) {
    if (this.disposed) return;
    const pending = this.pendingCheckReason;
    if (!pending || CHECK_REASON_RANK[reason] > CHECK_REASON_RANK[pending]) this.pendingCheckReason = reason;
    if (this.checkQueued) return;
    this.checkQueued = true;
    queueMicrotask(() => {
      this.checkQueued = false;
      if (!this.disposed) this.runCheck();
    });
  }

  /** The user asked for fresh data: drop any check in flight and revalidate. */
  refreshManifest() {
    this.validationInFlight?.controller.abort();
    this.validationInFlight = null;
    this.forceValidation = true;
    this.requestManifestCheck("user");
  }

  /** Retry the current page. The page endpoint authorizes independently, so a
   * failed or empty manifest must not turn Retry into a page-list waterfall. */
  retryPage() {
    if (this.disposed) return;
    const slug = this.currentSlug;
    const page = this.manifest?.pages.find((item) => item.slug === slug);
    if (!page) {
      this.env.onMetrics({ status: "syncing", navigationFreshness: "checking", message: "Refreshing manifest before retry" });
      this.forceValidation = true;
      this.requestManifestCheck("user");
    }
    this.env.onMetrics({ status: "syncing", message: `Retrying ${slug}`, failedBodySlug: null });
    void this.fetchSlug(slug, page, true).catch(() => undefined);
  }

  online() {
    this.requestManifestCheck("attention");
    this.syncRoute();
  }

  visibilityChanged() {
    if (this.env.visibility() === "visible") this.requestManifestCheck("attention");
  }

  /** The document may be leaving. Pause manifest imports until it either
   * leaves or comes back; a canceled navigation must not leave the reader
   * paused, so resume on its own after a second. */
  departing() {
    this.navigationPending = true;
    if (this.resumeTimer !== undefined) this.env.clearTimeout(this.resumeTimer);
    this.resumeTimer = this.env.setTimeout(() => this.resumed(), 1000);
  }

  resumed() {
    if (this.resumeTimer !== undefined) this.env.clearTimeout(this.resumeTimer);
    this.resumeTimer = undefined;
    if (!this.navigationPending) return;
    this.navigationPending = false;
    this.forceValidation = true;
    this.requestManifestCheck("attention");
  }

  private readCachedManifest(): WikiManifest | null {
    const { store, scope } = this.env;
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
  private syncRoute() {
    const { store, scope, onMetrics } = this.env;
    const slug = this.currentSlug;
    for (const [key, controller] of this.inFlight) {
      if (key !== `${scope}:${slug}`) controller.abort();
    }
    // The current HTTP response already supplied this body. A fresh manifest
    // still reconciles updates and removals through the manifest check.
    if (this.env.hasBootstrappedPage(slug)) return;
    const state = store.query(siteState$) as SiteStateRow | null;
    const indexed = store.query(pageIndexBySlug$(slug)) as PageIndexRow | null;
    if (indexed) {
      void this.fetchSlug(slug, indexRowToPage(indexed), this.env.seededFromStartupCache).catch(() => undefined);
      return;
    }
    if (state?.lastValidatedAt) {
      const cached = store.query(pageContentBySlug$(slug)) as PageContentRow | null;
      if (cached?.contentStatus !== "missing") {
        store.commit(events.pageContentMissing({ slug, contentHash: null, missingAt: this.env.now() }));
        onMetrics({ eventCount: 1 });
      }
    } else {
      // The body endpoint enforces the gate and access rules itself and
      // includes the page's metadata. A cold reader need not wait for the
      // whole site manifest before asking for the one page the user opened.
      void this.fetchSlug(slug).catch(() => undefined);
    }
  }

  async fetchSlug(slug: string, pageIndex?: WikiManifestPage, force = false) {
    const { store, scope, client, onMetrics } = this.env;
    const cacheKey = `${scope}:${slug}`;
    const existing = this.inFlight.get(cacheKey);
    if (existing && !force) return;
    existing?.abort();

    const cached = store.query(pageContentBySlug$(slug)) as PageContentRow | null;
    // P11: the manifest names each body by its hash. A stored body with the
    // listed hash is that body, however long ago it arrived. A publish changes
    // the hash (and so the URL below); the manifest check delivers it.
    if (!force && isStoredBodyCurrent(cached, pageIndex)) return;

    const controller = new AbortController();
    this.inFlight.set(cacheKey, controller);
    if (slug === this.currentSlug) {
      this.env.setPageTransfer({ slug, receivedBytes: 0 });
      onMetrics({ failedBodySlug: null });
    }
    this.env.foregroundFetch();
    try {
      // Forced reads (retry, a startup snapshot) bypass the HTTP cache.
      const batch = await client.fetchPages({ slugs: [slug], signal: controller.signal,
        ...(force ? {} : { versions: [pageIndex?.contentHash] }),
        onProgress: receivedBytes => {
          if (!controller.signal.aborted && slug === this.currentSlug) this.env.setPageTransfer({ slug, receivedBytes });
        },
      });
      if (controller.signal.aborted) return;
      const page = normalizeFetchedPageSlug(slug, batch.pages);
      if (page) {
        store.commit(pageToEvent(page));
        onMetrics({ markdownBytes: page.size, eventCount: 1, ...(slug === this.currentSlug ? { failedBodySlug: null } : {}) });
        return;
      }
      const unavailable = batch.unavailable?.find((item) => item.slug === slug);
      if (unavailable) {
        store.commit(events.pageContentUnavailable({
          slug: unavailable.slug, title: unavailable.title, tags: unavailable.tags, contentHash: unavailable.contentHash,
          sensitive: unavailable.sensitive, size: unavailable.size, unavailableAt: this.env.now(),
        }));
        onMetrics({ eventCount: 1 });
        return;
      }
      store.commit(events.pageContentMissing({ slug, contentHash: pageIndex?.contentHash ?? null, missingAt: this.env.now() }));
      onMetrics({ eventCount: 1 });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isAuthError(error)) {
        this.env.clearStartupSnapshot();
        store.commit(events.cacheResetRequested({ requestedAt: this.env.now() }));
        onMetrics({ status: "error", errorReason: "auth", message: "Session expired; local session cache cleared", eventCount: 1, failedBodyFetches: 1 });
      } else if (!this.env.online()) {
        // Keep the current page up; going online retries this route.
        onMetrics({ status: "offline", navigationFreshness: "offline", message: "Offline: using local cache", failedBodyFetches: 1 });
      } else {
        onMetrics({
          ...(slug === this.currentSlug
            ? { status: "error" as const, errorReason: syncErrorReason("body", error), message: `Failed to fetch markdown for ${slug}`, failedBodySlug: slug }
            : {}),
          failedBodyFetches: 1,
        });
      }
      throw error;
    } finally {
      if (this.inFlight.get(cacheKey) === controller) {
        this.inFlight.delete(cacheKey);
        if (slug === this.currentSlug) this.env.setPageTransfer(null);
      }
    }
  }

  /** One manifest check. A newer check supersedes this one's continuation. */
  private runCheck() {
    const generation = ++this.generation;
    if (this.refreshTimer !== undefined) this.env.clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    void this.check(() => generation !== this.generation || this.disposed);
  }

  private scheduleRefresh(cancelled: () => boolean, delayMs: number) {
    // A check that resolves after it was superseded must not leave a timer.
    if (cancelled()) return;
    this.refreshTimer = this.env.setTimeout(
      // A hidden tab stops here. Becoming visible requests its own check.
      () => { if (timerMayCheck(this.env.visibility())) this.requestManifestCheck("timer"); },
      Math.max(0, delayMs),
    );
  }

  private async check(cancelled: () => boolean) {
    const { store, scope, client, onMetrics } = this.env;
    let requestController: AbortController | undefined;
    const cachedManifest = this.manifest?.scope === scope ? this.manifest : this.readCachedManifest();
    this.manifest = cachedManifest;
    const cachedState = store.query(siteState$) as SiteStateRow | null;
    const now = this.env.now();
    const forceValidation = this.forceValidation;
    this.forceValidation = false;
    const reason: ManifestCheckReason = !this.checkedOnce ? "load" : this.pendingCheckReason ?? "attention";
    this.pendingCheckReason = null;
    this.checkedOnce = true;
    if (reason !== "timer") this.unchangedChecks = 0;
    const freshnessMs = MANIFEST_FRESH_MS[scope];
    const cacheAge = cachedState ? now - cachedState.lastValidatedAt : Number.POSITIVE_INFINITY;

    if (cachedManifest && !forceValidation && cacheAge < freshnessMs) {
      onMetrics({
        status: "ready",
        navigationFreshness: "current",
        message: `Using fresh manifest ${cachedManifest.manifestHash.slice(0, 8)}`,
        manifestBytes: cachedState?.manifestSize ?? 0,
      });
      this.scheduleRefresh(cancelled, freshnessMs - cacheAge);
      return;
    }

    // Always try: navigator.onLine can be false while the network works, and
    // a real outage fails fast into the offline handling below.
    const syncStart = this.env.elapsed();
    this.env.setManifestReceivedBytes(0);
    // Unattended checks stay silent: flipping the status every interval made
    // the live region announce "Checking…" to screen readers all day.
    if (announcesManifestCheck(reason, Boolean(cachedManifest))) {
      onMetrics({ status: "syncing", navigationFreshness: "checking", message: cachedManifest ? "Checking for wiki updates" : "Loading manifest" });
    }
    try {
      const validationKey = `${scope}:${cachedManifest?.manifestHash ?? "empty"}`;
      const reused = this.validationInFlight?.key === validationKey ? this.validationInFlight : null;
      requestController = reused?.controller ?? new AbortController();
      const signal = requestController.signal;
      const validationPromise = reused?.promise ?? client.validateManifest(cachedManifest?.manifestHash,
        receivedBytes => { if (!signal.aborted) this.env.setManifestReceivedBytes(receivedBytes); },
        signal);
      this.validationInFlight = { key: validationKey, promise: validationPromise, controller: requestController };
      this.env.foregroundFetch();
      let validation: WikiManifestValidation;
      try {
        validation = await validationPromise;
      } finally {
        if (this.validationInFlight?.promise === validationPromise) this.validationInFlight = null;
      }
      if (cancelled()) return;
      const validatedAt = this.env.now();
      const hasCompleteSnapshot = Boolean(cachedManifest) && (cachedState?.lastValidatedAt ?? 0) > 0;
      if (validation.status === "unchanged" && cachedManifest) {
        if (validation.partial) {
          onMetrics({
            status: "ready",
            navigationFreshness: "saved",
            message: hasCompleteSnapshot ? "Partial refresh ignored; using complete cached manifest" : "Provisional manifest loaded; retrying full manifest",
            manifestBytes: cachedState?.manifestSize ?? 0,
          });
          this.scheduleRefresh(cancelled, nextManifestRetryDelay(this.manifestFailures++));
          return;
        }
        this.manifestFailures = 0;
        if (reason === "timer") this.unchangedChecks += 1;
        store.commit(events.manifestValidated({ manifestHash: cachedManifest.manifestHash, validatedAt }));
        onMetrics({
          status: "ready",
          navigationFreshness: "current",
          message: `Manifest ${cachedManifest.manifestHash.slice(0, 8)} is current`,
          manifestBytes: cachedState?.manifestSize ?? 0,
          eventCount: 1,
          lastSyncMs: this.env.elapsed() - syncStart,
        });
        this.scheduleRefresh(cancelled, nextManifestCheckDelay(scope, this.unchangedChecks));
        return;
      }

      if (validation.status !== "modified") throw new Error("Manifest validation returned no replacement snapshot");
      if (validation.partial && hasCompleteSnapshot) {
        onMetrics({ status: "ready", navigationFreshness: "saved", message: "Partial refresh ignored; using complete cached manifest", manifestBytes: cachedState?.manifestSize ?? 0 });
        this.scheduleRefresh(cancelled, nextManifestRetryDelay(this.manifestFailures++));
        return;
      }
      const manifest = validation.manifest;
      // Leave the fetch promise's microtask checkpoint before the atomic
      // import, so a queued navigation runs its departure hook instead of
      // waiting on work for a document the reader is leaving.
      await new Promise<void>(resolve => this.env.setTimeout(resolve, 0));
      if (cancelled() || this.navigationPending) return;
      this.unchangedChecks = 0;
      if (!validation.partial) this.manifestFailures = 0;
      this.manifest = manifest;
      // A manifest is one LiveStore event, so its tree and indexes replace the
      // prior snapshot in the materializer's single transaction.
      if (validation.partial) {
        store.commit(manifestToEvent(manifest, validatedAt), events.manifestMarkedProvisional({ manifestHash: manifest.manifestHash }));
      } else {
        store.commit(manifestToEvent(manifest, validatedAt));
      }
      const activeSlug = this.currentSlug;
      void this.fetchSlug(activeSlug, manifest.pages.find((page) => page.slug === activeSlug)).catch(() => undefined);
      const storage = await this.env.storageSnapshot();
      if (cancelled()) return;
      onMetrics({
        status: "ready",
        navigationFreshness: validation.partial ? "saved" : "current",
        message: validation.partial ? "Provisional manifest loaded; retrying full manifest" : `Manifest ${manifest.manifestHash.slice(0, 8)} loaded`,
        manifestBytes: byteSize(JSON.stringify(manifest)),
        eventCount: 1,
        lastSyncMs: this.env.elapsed() - syncStart,
        opfsBytes: storage.usage,
        storageQuotaBytes: storage.quota,
        storagePressure: storage.pressure,
      });
      this.scheduleRefresh(cancelled, validation.partial ? nextManifestRetryDelay(this.manifestFailures++) : freshnessMs);
      // Background prefetch warms ranked pages after the active body is ready.
    } catch (error) {
      if (requestController?.signal.aborted || cancelled()) return;
      if (isAuthError(error)) {
        this.env.clearStartupSnapshot();
        store.commit(events.cacheResetRequested({ requestedAt: this.env.now() }));
        onMetrics({ status: "error", errorReason: "auth", navigationFreshness: "saved", message: "Session expired; local session cache cleared", eventCount: 1 });
        return;
      }
      const online = this.env.online();
      if (cachedManifest) {
        onMetrics({
          status: online ? "ready" : "offline",
          navigationFreshness: online ? "saved" : "offline",
          message: online ? "Refresh failed; using cached manifest" : "Offline: using local cache",
        });
        this.scheduleRefresh(cancelled, nextManifestRetryDelay(this.manifestFailures++));
      } else {
        onMetrics({
          status: online ? "error" : "offline",
          errorReason: syncErrorReason("manifest", error),
          navigationFreshness: online ? "saved" : "offline",
          message: error instanceof Error ? error.message : String(error),
        });
        // A brief lost connection must not strand an empty reader until
        // reload. Keep one bounded retry timer, also resumed by online.
        this.scheduleRefresh(cancelled, Math.min(30_000, 5_000 * 2 ** Math.min(this.manifestFailures++, 3)));
      }
    }
  }
}

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
