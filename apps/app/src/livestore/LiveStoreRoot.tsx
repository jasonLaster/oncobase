import { makeInMemoryAdapter, makePersistedAdapter } from "@livestore/adapter-web";
import { rootHandlePromise } from "@livestore/adapter-web/opfs-utils";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import liveStoreSharedWorkerUrl from "@livestore/adapter-web/shared-worker?sharedworker&url";
import { LiveStoreContext, LiveStoreProvider } from "@livestore/react";
import { makeWikiStoreId, type WikiScope, type WikiSessionIdentity } from "@oncobase/wiki-content";
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
  useRef,
  useState,
} from "react";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";
import { sameStartupIdentity, startupInitialData, type StartupSnapshot } from "../bootstrap/reader-startup-cache";
import { keepsPresentationMounted } from "../bootstrap/session-handoff";
import { SessionHandoffSync } from "../sync/SessionHandoffSync";
import type { ReaderHandoffOutcome } from "../../shared/reader-telemetry";
import { readInitialReaderData } from "../bootstrap/initial-reader-data";
import { InitialReaderContext, useReaderStore } from "../bootstrap/reader-queries";
import { App } from "../App";
import { ReaderPending } from "../AppStarting";
import { CanonicalRouteBoundary } from "../CanonicalRouteBoundary";
import { WikiAuthProvider } from "../shell/Header";
import { WikiScopeProvider, WikiSessionProvider } from "../wiki-context";
import { ReaderCacheRetirement } from "./ReaderCacheRetirement";
import { readDevtoolsFooterVisible, readLiveStoreDevtoolsEnabled } from "./devtools";
import LiveStoreWorker from "./livestore.worker?worker";
import liveStoreWorkerUrl from "./livestore.worker?worker&url";
import { schema } from "./schema";
import { makeFastPathSnapshotReader } from "./fast-path-snapshot";
import { setStoreBootPath } from "./store-boot-path";
import { dismissFirstFrameSnapshot } from "./first-frame-snapshot";
import { StoreStartupLoading } from "./StoreStartup";
import { resolveReaderStorage, isDiagnosticMemoryStorageRequest, readerBootDeadline, networkAwareBootDeadline,
  READER_LEADER_BOOT_TIMEOUT_MS, READER_FOLLOWER_BOOT_TIMEOUT_MS } from "./reader-storage";
import { markSessionHandoff, markVisualPhase } from "../visual-phase";
import { recordReaderPhase, recordReaderSpan } from "../reader-telemetry";
import type { ReaderReason } from "../../shared/reader-telemetry";
import { observeMeasures, observeWorkerBoot } from "./worker-boot-telemetry";
import { SessionCacheRetirement } from "./SessionCacheRetirement";
import { createReaderBoot, readerBootRequest } from "../bootstrap/seed-state";
import {
  STORE_BOOT_RETRY_DELAY_MS,
  shouldRetryStoreBoot,
  toBootError,
} from "./store-boot-retry";

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
const storageMode = isDiagnosticMemoryStorageRequest(new URL(location.href))
  ? Promise.resolve("memory" as const)
  : resolveReaderStorage({ getDirectory: () => rootHandlePromise });
const adapterPromise = storageMode.then((mode) => {
  markVisualPhase("storage-ready", { mode });
  if (mode === "opfs") {
    prefetchWorkerScripts();
    return persistedAdapter;
  }
  console.warn("[wiki-vite] Persistent cache unavailable; using temporary reader storage");
  return temporaryAdapter;
});

// The adapter constructs its workers only after this module's SQLite wasm has
// loaded, so a cold load downloaded wasm, then worker scripts, in series. Warm
// the HTTP cache (immutable assets) now so both download in parallel; worker
// construction then reads them from cache. Nothing is executed here.
function prefetchWorkerScripts() {
  for (const url of [liveStoreSharedWorkerUrl, liveStoreWorkerUrl]) {
    try {
      void fetch(url, { credentials: "same-origin" }).then(response => response.ok ? response.arrayBuffer() : null).catch(() => {});
    } catch { /* Optional warm-up only. */ }
  }
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

export function LiveStoreRoot({ identity, presentationIdentity, scope, cachedSnapshot }: {
  cachedSnapshot?: StartupSnapshot | null;
  identity: WikiSessionIdentity | null;
  presentationIdentity?: WikiSessionIdentity | null;
  scope: WikiScope;
}) {
  const storeId = identity ? makeWikiStoreId({
    siteSlug: identity.siteSlug,
    scope,
    origin: window.location.origin,
    cacheKey: identity.cacheKey,
  }) : null;
  const [firstPartition, setFirstPartition] = useState(storeId);
  if (storeId && !firstPartition) setFirstPartition(storeId);
  const displayIdentity = identity ?? presentationIdentity;
  if (!displayIdentity || (!storeId && firstPartition)) return <ReaderPending />;
  // The pending public presentation has no database. Keep that first mount
  // for its first verified identity only; subsequent partition changes still
  // reset the entire reader, adapter, deadlines and retry budget together.
  const key = !storeId || storeId === firstPartition
    ? `initial:${displayIdentity.siteSlug}` : storeId;
  return <ReaderStore key={key} storeId={storeId} identity={identity}
    displayIdentity={displayIdentity} cachedSnapshot={cachedSnapshot} scope={identity ? scope : displayIdentity.scope} />;
}

function ReaderStore({ identity, displayIdentity, scope, storeId, cachedSnapshot }: {
  cachedSnapshot?: StartupSnapshot | null;
  identity: WikiSessionIdentity | null;
  displayIdentity: WikiSessionIdentity;
  scope: WikiScope;
  storeId: string | null;
}) {
  // Once a store exists, its complete partition controls remounts. Refreshing an
  // equivalent identity must not change boot: LiveStore would restart the
  // provider and discard the mounted article. A new partition remounts us.
  const [initial, setInitial] = useState(() => cachedSnapshot ? startupInitialData(cachedSnapshot, location.pathname) : readInitialReaderData(displayIdentity));
  const [bootstrapMode] = useState(() => Boolean(initial));
  const [liveContext, setLiveContext] = useState<ContextType<typeof LiveStoreContext>>();
  const [handedOff, setHandedOff] = useState(false);
  const [initialExpired, setInitialExpired] = useState(false);
  // A cached public page met a verified session (the caller keeps us mounted
  // only then). The session store starts empty: keep presenting the public page
  // while the running store syncs this route out of sight, then swap in one commit.
  const prepareHandoff = Boolean(bootstrapMode && identity && cachedSnapshot &&
    !sameStartupIdentity(cachedSnapshot.identity, identity) && keepsPresentationMounted(cachedSnapshot.identity, identity));
  const [handoffOutcome, setHandoffOutcome] = useState<ReaderHandoffOutcome | null>(null);
  const handoffStartedAt = useRef<number | null>(null);
  useEffect(() => {
    if (prepareHandoff && handoffStartedAt.current === null) handoffStartedAt.current = performance.now();
  }, [prepareHandoff]);
  const awaitingHandoff = prepareHandoff && !handoffOutcome;
  const runningContext = awaitingHandoff ? undefined : liveContext;
  const handOff = useCallback(() => {
    performance.mark("wiki-reader-live-handoff");
    markVisualPhase("reader-live-handoff");
    setHandedOff(true);
    setInitial(null);
  }, []);
  const publishStore = useCallback((value: ContextType<typeof LiveStoreContext>) => {
    setLiveContext(value);
    if (value && !prepareHandoff) handOff();
  }, [handOff, prepareHandoff]);
  const handoffSettled = useRef(false);
  const settleHandoff = useCallback((outcome: Exclude<ReaderHandoffOutcome, "remount-required">) => {
    if (handoffSettled.current) return;
    handoffSettled.current = true;
    markSessionHandoff(outcome, handoffStartedAt.current ?? performance.now());
    setHandoffOutcome(outcome);
    handOff();
  }, [handOff]);
  useEffect(() => {
    if (!initial || handedOff) return;
    const timer = window.setTimeout(() => setInitialExpired(true), Math.max(0, initial.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [initial, handedOff]);
  const [request] = useState(readerBootRequest);
  const [bootState, setBootState] = useState(() => identity ? { boot: createReaderBoot(identity, request, cachedSnapshot) } : null);
  if (identity && !bootState) setBootState({ boot: createReaderBoot(identity, request, cachedSnapshot) });
  const [adapter, setAdapter] = useState<Awaited<typeof adapterPromise> | null>(null);
  const [bootTimeoutMs, setBootTimeoutMs] = useState(READER_LEADER_BOOT_TIMEOUT_MS);
  const [runtimeTimeoutMs] = useState(() => networkAwareBootDeadline(15_000,
    performance.getEntriesByType("resource") as PerformanceResourceTiming[], location.origin));
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!storeId) return;
    let active = true;
    void Promise.all([adapterPromise, readerBootDeadline(navigator.locks, storeId)]).then(([resolved, deadline]) => {
      // A late probe must not replace a temporary store already in use.
      if (active) {
        bootProgress.follower = deadline === READER_FOLLOWER_BOOT_TIMEOUT_MS;
        markVisualPhase(bootProgress.follower ? "store-existing-leader" : "store-new-leader");
        setBootTimeoutMs(networkAwareBootDeadline(deadline,
          performance.getEntriesByType("resource") as PerformanceResourceTiming[], location.origin));
        setAdapter((current: Awaited<typeof adapterPromise> | null) => current ?? resolved);
      }
    });
    return () => { active = false; };
  }, [storeId]);
  const [bootAttempt, setBootAttempt] = useState(0);
  const retryBoot = useCallback(() => setBootAttempt((attempt) => attempt + 1), []);
  const recoverStalledBoot = useCallback(() => {
    markVisualPhase("store-timeout", { temporary: adapter === temporaryAdapter, reason: timeoutReason(adapter === temporaryAdapter, Boolean(adapter)) });
    dismissFirstFrameSnapshot();
    if (adapter === temporaryAdapter) {
      setStalled(true);
      return;
    }
    console.warn("[wiki-vite] Reader startup timed out; using temporary storage");
    // Unmount the old provider so its scope releases its workers/lock request.
    // Never steal a lock or reset persistence belonging to another live tab.
    setAdapter(() => temporaryAdapter);
    setBootAttempt(0);
  }, [adapter]);
  const liveStoreDevtoolsEnabled = useMemo(() => readLiveStoreDevtoolsEnabled(), []);
  const devtoolsFooterVisible = useMemo(() => readDevtoolsFooterVisible(), []);

  const app = <ReaderApp identity={displayIdentity} scope={scope} storeId={storeId ?? ""}
    devtoolsFooterVisible={devtoolsFooterVisible} liveStoreDevtoolsEnabled={liveStoreDevtoolsEnabled} />;
  if (stalled) return <StoreStartupRecovery />;
  const provider = !identity || !storeId || !bootState ? null : !adapter ? <StoreStartupLoading onTimeout={recoverStalledBoot} /> : (
    <StoreBootRetryBoundary key={`${adapter === temporaryAdapter}:${bootAttempt}`} attempt={bootAttempt} onRetry={retryBoot}>
      <LiveStoreProvider
        boot={bootState.boot}
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
        renderShutdown={() => bootstrapMode ? <StopEarlyReader stop={setStalled} /> : <StoreStartupRecovery />}
        renderError={(error) => (
          <StoreBootError error={error} attempt={bootAttempt} onRetry={retryBoot} />
        )}
      >
        {bootstrapMode ? <>
          <PublishReaderStore publish={publishStore} />
          {awaitingHandoff ? <SessionHandoffSync scope={scope} onSettled={settleHandoff} /> : null}
        </> : app}
      </LiveStoreProvider>
    </StoreBootRetryBoundary>
  );

  if (!bootstrapMode) return provider ?? <ReaderPending />;
  return (
    <>
      {/* This provider owns lifecycle only. A retry must not insert a second
          launching screen ahead of the already mounted reader. Errors still
          propagate, and shutdown switches the visible reader to recovery. */}
      <div hidden data-reader-cache-startup={Boolean(cachedSnapshot)}>{provider}</div>
      <LiveStoreContext.Provider value={runningContext}>
        <InitialReaderContext.Provider value={runningContext || handedOff || initialExpired ? null : initial}>
          {runningContext || (!handedOff && !initialExpired) ? app : <StoreStartupRecovery />}
        </InitialReaderContext.Provider>
      </LiveStoreContext.Provider>
    </>
  );
}

// Keep the app at one React position while the provider completes or retries.
// Forward only a real, running LiveStore context; never manufacture a store.
function PublishReaderStore({ publish }: { publish: (value: ContextType<typeof LiveStoreContext>) => void }) {
  const value = useContext(LiveStoreContext);
  useLayoutEffect(() => {
    publish(value);
    return () => publish(undefined);
  }, [publish, value]);
  return null;
}

function StopEarlyReader({ stop }: { stop: (stopped: boolean) => void }) {
  useLayoutEffect(() => { stop(true); }, [stop]);
  return null;
}

function ReaderApp({ identity, scope, storeId, devtoolsFooterVisible, liveStoreDevtoolsEnabled }: {
  identity: WikiSessionIdentity; scope: WikiScope; storeId: string;
  devtoolsFooterVisible: boolean; liveStoreDevtoolsEnabled: boolean;
}) {
  const store = useReaderStore();
  return (
        <WikiSessionProvider identity={identity}>
          <WikiScopeProvider scope={scope}>
            {store ? <SessionCacheRetirement identity={identity} scope={scope} /> : null}
            {store ? <ReaderCacheRetirement identity={identity} scope={scope} /> : null}
            {store ? <Suspense fallback={null}><ReaderStartupCacheWriter identity={identity} /></Suspense> : null}
            <WikiAuthProvider>
              <CanonicalRouteBoundary>
                <App
                  devtoolsFooterVisible={devtoolsFooterVisible}
                  liveStoreDevtoolsEnabled={liveStoreDevtoolsEnabled}
                  storeId={storeId}
                />
              </CanonicalRouteBoundary>
            </WikiAuthProvider>
          </WikiScopeProvider>
        </WikiSessionProvider>
  );
}
