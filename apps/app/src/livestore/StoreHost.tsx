import { makeInMemoryAdapter, makePersistedAdapter } from "@livestore/adapter-web";
import { rootHandlePromise } from "@livestore/adapter-web/opfs-utils";
import { isWebStorageAvailable } from "@oncobase/safe-storage";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { LiveStoreContext, LiveStoreProvider } from "@livestore/react";
import type { WikiScope, WikiSessionIdentity } from "@oncobase/wiki-content";
import {
  Component,
  Suspense,
  lazy,
  type ReactNode,
  type ContextType,
  useContext,
  useLayoutEffect,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";
import type { StartupSnapshot } from "../bootstrap/reader-startup-cache";
import { ReaderStoreContext, useReaderStoreKit, type ReaderStoreKit, type RunningLiveStoreContext } from "../bootstrap/reader-queries";
import { ReaderPending } from "../AppStarting";
import { SessionHandoffSync } from "../sync/SessionHandoffSync";
import { WikiSync } from "../sync/WikiSync";
import type { ReaderHandoffOutcome, ReaderReason } from "../../shared/reader-telemetry";
import type { MetricsPatch } from "../types";
import { useWikiScope, useWikiSession } from "../wiki-context";
import { ReaderCacheRetirement } from "./ReaderCacheRetirement";
import { SessionCacheRetirement } from "./SessionCacheRetirement";
import { readLiveStoreDevtoolsEnabled } from "./devtools";
import LiveStoreWorker from "./livestore.worker?worker";
import * as queries from "./queries";
import { events, schema } from "./schema";
import { makeFastPathSnapshotReader } from "./fast-path-snapshot";
import { setStoreBootPath } from "./store-boot-path";
import { dismissFirstFrameSnapshot } from "./first-frame-snapshot";
import { StoreStartupLoading } from "./StoreStartup";
import { resolveReaderStorage, isDiagnosticMemoryStorageRequest, readerBootDeadline, networkAwareBootDeadline,
  READER_LEADER_BOOT_TIMEOUT_MS, READER_FOLLOWER_BOOT_TIMEOUT_MS, type ReaderStorageResolution } from "./reader-storage";
import { markVisualPhase } from "../visual-phase";
import { recordReaderPhase, recordReaderSpan } from "../reader-telemetry";
import { observeMeasures, observeWorkerBoot } from "./worker-boot-telemetry";
import { createReaderBoot } from "../bootstrap/seed-state";
import { recordStoreFallback } from "./store-fallback";
import { storeRuntimeDownloads, RUNTIME_DOWNLOAD_DEADLINE_MS } from "./runtime-downloads";
import {
  STORE_BOOT_RETRY_DELAY_MS,
  shouldRetryStoreBoot,
  toBootError,
} from "./store-boot-retry";

// The store half of the reader. ReaderRoot (paint-critical) renders the shell
// and article first, then imports this module, which brings Effect, LiveStore,
// the workers and SQLite. Nothing here decides what content may be shown.

const StoreStartupRecovery = lazy(() => import("./StoreStartupRecovery"));
const ReaderStartupCacheWriter = lazy(() => import("../bootstrap/ReaderStartupCacheWriter").then(module => ({ default: module.ReaderStartupCacheWriter })));

markVisualPhase("boot-store-module");

// sessionStorage is copied by duplicated/opener tabs. A per-document ID
// prevents two live tabs from presenting the same LiveStore session identity.
const sessionId = crypto.getRandomValues(new Uint32Array(4)).join("-");
// Furthest boot milestone reached on this page; classifies a store timeout.
const bootProgress = { follower: false, workerCreated: false, dbOpen: false, adapterDone: false };
observeWorkerBoot(sessionId, ({ kind, at, duration }) => {
  const offset = at - performance.timeOrigin;
  if (kind === "script") return recordReaderPhase("store-worker-script", undefined, offset);
  if (kind === "db-open") bootProgress.dbOpen = true;
  recordReaderSpan(kind === "db-open" ? "store-worker-db-open" : "store-worker-recreate", offset, duration);
});
// LiveStore measures its whole adapter boot on this thread: lock, workers,
// leader boot, snapshot transfer and import, up to the client session.
observeMeasures({ "livestore:makeAdapter": "adapter" }, (_, start, duration) => {
  bootProgress.adapterDone = true;
  recordReaderSpan("store-adapter", start, duration);
});
function timeoutReason(temporary: boolean, hasAdapter: boolean): ReaderReason {
  if (temporary) return "temporary";
  if (!hasAdapter) return "adapter";
  if (bootProgress.adapterDone) return "store-create";
  if (bootProgress.dbOpen) return "leader-boot";
  if (bootProgress.workerCreated) return "worker-boot";
  return bootProgress.follower ? "follower" : "lock-wait";
}

const persistedAdapter = makePersistedAdapter({
  sessionId,
  storage: { type: "opfs" },
  // Construction marks: the dedicated worker exists only once this tab holds the leader lock.
  worker: (options: { name: string }) => {
    bootProgress.workerCreated = true;
    markVisualPhase("store-worker-created");
    return new LiveStoreWorker(options);
  },
  sharedWorker: (options: { name: string }) => {
    markVisualPhase("store-shared-worker-created");
    return new LiveStoreSharedWorker(options);
  },
  // Rapid route reloads (and other tabs) can overlap the client-side OPFS
  // snapshot read with the leader's writes, or leave a killed leader's hot
  // journal. The patched adapter calls fastPathSnapshot instead of LiveStore's
  // unguarded read: it returns only a committed image (no journal, valid
  // header, identical across two reads) and otherwise asks the leader for a
  // recreated snapshot, so a partially observed SQLite image never reaches
  // React queries. disableFastPath keeps the unguarded read off if the patch
  // is ever lost (every boot then uses the leader snapshot, as before).
  experimental: {
    disableFastPath: true,
    fastPathSnapshot: makeFastPathSnapshotReader(rootHandlePromise, (path, start, duration) => {
      setStoreBootPath(path);
      recordReaderSpan("store-fast-path", start, duration);
    }),
  },
});
// This store is a server-backed reader cache, not the source of user writes.
// When OPFS is unavailable, keep the online reader working in a tab-local cache.
// Consume the library's eager OPFS probe too, so a denied handle cannot become
// an unhandled rejection even when the temporary adapter is selected.
const inMemoryAdapter = makeInMemoryAdapter();
const temporaryAdapter: typeof inMemoryAdapter = (args) => {
  setStoreBootPath("memory");
  return inMemoryAdapter(args);
};
const storage: Promise<ReaderStorageResolution> = isDiagnosticMemoryStorageRequest(new URL(location.href))
  ? Promise.resolve({ mode: "memory", reason: "storage-diagnostic" })
  : resolveReaderStorage({ getDirectory: () => rootHandlePromise });
const adapterPromise = storage.then((resolution) => {
  // LiveStore's persisted adapter reads Web Storage raw (client and session ids)
  // and throws into the recovery card when it is blocked, even with OPFS available.
  const { mode, reason } = resolution.mode === "opfs" && !(isWebStorageAvailable("localStorage") && isWebStorageAvailable("sessionStorage"))
    ? { mode: "memory" as const, reason: "storage-web-storage-blocked" as const }
    : resolution;
  // The mode and its cause, so a memory boot can be explained afterwards.
  markVisualPhase("storage-ready", { mode, reason });
  if (mode === "opfs") return persistedAdapter;
  recordStoreFallback(reason);
  console.warn("[wiki-vite] Persistent cache unavailable; using temporary reader storage");
  return temporaryAdapter;
});
// SQLite and the worker scripts, usually already started by the document's
// head script. Boot deadlines start once these have arrived (or after a bounded
// wait), so a slow link is not mistaken for a stuck store.
const runtimeReady = adapterPromise.then(adapter => adapter === persistedAdapter
  ? storeRuntimeDownloads(RUNTIME_DOWNLOAD_DEADLINE_MS) : undefined);

const kits = new WeakMap<RunningLiveStoreContext, ReaderStoreKit>();
function kitFor(context: RunningLiveStoreContext): ReaderStoreKit {
  let kit = kits.get(context);
  if (!kit) {
    kit = { context, store: context.store, queries, events, Scope: StoreScope };
    kits.set(context, kit);
  }
  return kit;
}

/** LiveStore's own context for store-side components, from the published kit. */
function StoreScope({ children }: { children: ReactNode }) {
  const kit = useReaderStoreKit();
  return <LiveStoreContext.Provider value={kit?.context}>{children}</LiveStoreContext.Provider>;
}

/** Inside the provider (no early reader): expose the running store as a kit. */
function KitBridge({ children }: { children: ReactNode }) {
  const value = useContext(LiveStoreContext);
  const kit = useMemo(() => value ? kitFor(value) : null, [value]);
  return <ReaderStoreContext.Provider value={kit}>{children}</ReaderStoreContext.Provider>;
}

/** Sync, cache retirement and the startup snapshot writer. App renders this
 * inside StoreScoped once a store is running. */
export function StoreServices({ onMetrics }: { onMetrics: (patch: MetricsPatch) => void }) {
  const identity = useWikiSession();
  const scope = useWikiScope();
  return <>
    <WikiSync onMetrics={onMetrics} />
    {identity ? <>
      <SessionCacheRetirement identity={identity} scope={scope} />
      <ReaderCacheRetirement identity={identity} scope={scope} />
      <Suspense fallback={null}><ReaderStartupCacheWriter identity={identity} /></Suspense>
    </> : null}
  </>;
}

function BootRetryPending() {
  return <ReaderPending stage="retry" />;
}

// Handles boot failures the provider reports through renderError. On the
// first failure it schedules a delayed re-boot; afterwards it rethrows so the
// AppErrorBoundary recovery card stays the terminal state.
function StoreBootError({
  error,
  attempt,
  onRetry,
}: {
  error: unknown;
  attempt: number;
  onRetry: () => void;
}) {
  const retrying = shouldRetryStoreBoot(error, attempt);
  useEffect(() => {
    if (!retrying) return;
    console.warn("[wiki-vite] LiveStore boot failed; retrying once", error);
    const timer = window.setTimeout(onRetry, STORE_BOOT_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [retrying, error, onRetry]);
  if (!retrying) throw toBootError(error);
  return <BootRetryPending />;
}

type BootBoundaryProps = { attempt: number; onRetry: () => void; children: ReactNode };
type BootBoundaryState = { error: Error | null };

// Handles boot failures that throw during render (the store can also fail
// while the shell renders against a store that died mid-open). Same policy as
// StoreBootError: one delayed re-boot, then rethrow to the AppErrorBoundary.
class StoreBootRetryBoundary extends Component<BootBoundaryProps, BootBoundaryState> {
  state: BootBoundaryState = { error: null };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(error: Error): BootBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!shouldRetryStoreBoot(error, this.props.attempt)) return;
    console.warn("[wiki-vite] LiveStore boot failed; retrying once", error);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.props.onRetry();
    }, STORE_BOOT_RETRY_DELAY_MS);
  }

  componentWillUnmount() {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
  }

  render() {
    const { error } = this.state;
    if (error) {
      if (!shouldRetryStoreBoot(error, this.props.attempt)) throw error;
      return <BootRetryPending />;
    }
    return this.props.children;
  }
}

export type StoreHostProps = {
  identity: WikiSessionIdentity;
  storeId: string;
  scope: WikiScope;
  cachedSnapshot?: StartupSnapshot | null;
  /** The route this document was requested for, captured when the reader mounted. */
  request: { origin: string; pathname: string; apiOrigin: string };
  /** The early reader is already on screen: this host owns lifecycle only. */
  presenting: boolean;
  /** Rendered inside the provider when nothing is presenting yet. */
  app: ReactNode;
  awaitingHandoff: boolean;
  onPublish: (kit: ReaderStoreKit | undefined) => void;
  onHandoffSettled: (outcome: Exclude<ReaderHandoffOutcome, "remount-required">) => void;
  onStopped: (stopped: boolean) => void;
};

export function StoreHost({ identity, storeId, scope, cachedSnapshot, request, presenting, app, awaitingHandoff,
  onPublish, onHandoffSettled, onStopped }: StoreHostProps) {
  const [boot] = useState(() => createReaderBoot(identity, request, cachedSnapshot));
  const [adapter, setAdapter] = useState<Awaited<typeof adapterPromise> | null>(null);
  const [bootTimeoutMs, setBootTimeoutMs] = useState(READER_LEADER_BOOT_TIMEOUT_MS);
  const [runtimeTimeoutMs, setRuntimeTimeoutMs] = useState(15_000);
  useEffect(() => {
    let active = true;
    // Lock probe, storage probe and runtime downloads first; the deadlines
    // below then measure only the store's own boot.
    void Promise.all([adapterPromise, readerBootDeadline(navigator.locks, storeId), runtimeReady]).then(([resolved, deadline]) => {
      // A late probe must not replace a temporary store already in use.
      if (!active) return;
      bootProgress.follower = deadline === READER_FOLLOWER_BOOT_TIMEOUT_MS;
      markVisualPhase(bootProgress.follower ? "store-existing-leader" : "store-new-leader");
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      setBootTimeoutMs(networkAwareBootDeadline(deadline, resources, location.origin));
      setRuntimeTimeoutMs(networkAwareBootDeadline(15_000, resources, location.origin));
      setAdapter((current: Awaited<typeof adapterPromise> | null) => current ?? resolved);
    });
    return () => { active = false; };
  }, [storeId]);
  const [bootAttempt, setBootAttempt] = useState(0);
  const retryBoot = useCallback(() => setBootAttempt((attempt) => attempt + 1), []);
  const recoverStalledBoot = useCallback(() => {
    const temporary = adapter === temporaryAdapter;
    const reason = timeoutReason(temporary, Boolean(adapter));
    markVisualPhase("store-timeout", { temporary, reason });
    dismissFirstFrameSnapshot();
    if (temporary) {
      onStopped(true);
      return;
    }
    recordStoreFallback(reason);
    console.warn("[wiki-vite] Reader startup timed out; using temporary storage");
    // Unmount the old provider so its scope releases its workers/lock request.
    // Never steal a lock or reset persistence belonging to another live tab.
    setAdapter(() => temporaryAdapter);
    setBootAttempt(0);
  }, [adapter, onStopped]);
  const liveStoreDevtoolsEnabled = useMemo(() => readLiveStoreDevtoolsEnabled(), []);

  // Before the adapter: the downloads and probes above are bounded on their
  // own, so this deadline only catches a probe that never settles.
  if (!adapter) return <StoreStartupLoading timeoutMs={RUNTIME_DOWNLOAD_DEADLINE_MS + 15_000} onTimeout={recoverStalledBoot} />;
  return (
    <StoreBootRetryBoundary key={`${adapter === temporaryAdapter}:${bootAttempt}`} attempt={bootAttempt} onRetry={retryBoot}>
      <LiveStoreProvider
        boot={boot}
        key={bootAttempt}
        schema={schema}
        adapter={adapter}
        batchUpdates={batchUpdates}
        storeId={storeId}
        // Pending reader-cache writes are refetchable, not unsaved user edits.
        confirmUnsavedChanges={false}
        disableDevtools={!liveStoreDevtoolsEnabled}
        renderLoading={({ stage }) => (
          <StoreStartupLoading
            stage={stage}
            timeoutMs={adapter === persistedAdapter ? bootTimeoutMs : runtimeTimeoutMs}
            onTimeout={recoverStalledBoot}
          />
        )}
        renderShutdown={() => presenting ? <StopEarlyReader stop={onStopped} /> : <StoreStartupRecovery />}
        renderError={(error) => (
          <StoreBootError error={error} attempt={bootAttempt} onRetry={retryBoot} />
        )}
      >
        {presenting ? <>
          <PublishReaderStore publish={onPublish} />
          {awaitingHandoff ? <SessionHandoffSync scope={scope} onSettled={onHandoffSettled} /> : null}
        </> : <KitBridge>{app}</KitBridge>}
      </LiveStoreProvider>
    </StoreBootRetryBoundary>
  );
}

// Keep the app at one React position while the provider completes or retries.
// Forward only a real, running LiveStore context; never manufacture a store.
function PublishReaderStore({ publish }: { publish: (kit: ReaderStoreKit | undefined) => void }) {
  const value: ContextType<typeof LiveStoreContext> = useContext(LiveStoreContext);
  useLayoutEffect(() => {
    publish(value ? kitFor(value) : undefined);
    return () => publish(undefined);
  }, [publish, value]);
  return null;
}

function StopEarlyReader({ stop }: { stop: (stopped: boolean) => void }) {
  useLayoutEffect(() => { stop(true); }, [stop]);
  return null;
}
