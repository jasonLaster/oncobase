import { makeInMemoryAdapter, makePersistedAdapter } from "@livestore/adapter-web";
import { rootHandlePromise } from "@livestore/adapter-web/opfs-utils";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { LiveStoreProvider } from "@livestore/react";
import { makeWikiStoreId, type WikiScope, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import {
  Component,
  lazy,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";
import { App } from "../App";
import { CanonicalRouteBoundary } from "../CanonicalRouteBoundary";
import { WikiAuthProvider } from "../shell/Header";
import { WikiScopeProvider, WikiSessionProvider } from "../wiki-context";
import { FirstFrameSnapshotSync } from "./FirstFrameSnapshot";
import { readDevtoolsFooterVisible, readLiveStoreDevtoolsEnabled } from "./devtools";
import LiveStoreWorker from "./livestore.worker?worker";
import { schema } from "./schema";
import { dismissFirstFrameSnapshot } from "./first-frame-snapshot";
import { StoreStartupLoading } from "./StoreStartup";
import { resolveReaderStorage } from "./reader-storage";
import { SessionCacheRetirement } from "./SessionCacheRetirement";
import { createReaderBoot } from "../bootstrap/seed-state";
import {
  STORE_BOOT_RETRY_DELAY_MS,
  shouldRetryStoreBoot,
  toBootError,
} from "./store-boot-retry";

const StoreStartupRecovery = lazy(() => import("./StoreStartupRecovery"));

const persistedAdapter = makePersistedAdapter({
  // sessionStorage is copied by duplicated/opener tabs. A per-document ID
  // prevents two live tabs from presenting the same LiveStore session identity.
  sessionId: crypto.getRandomValues(new Uint32Array(4)).join("-"),
  storage: { type: "opfs" },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  // Rapid route reloads can overlap the optimistic client-side OPFS snapshot
  // read with the previous leader's final write. Ask the leader for a recreated
  // snapshot so a partially observed SQLite image never reaches React queries.
  experimental: { disableFastPath: true },
});
// This store is a server-backed reader cache, not the source of user writes.
// When OPFS is unavailable, keep the online reader working in a tab-local cache.
// Consume the library's eager OPFS probe too, so a denied handle cannot become
// an unhandled rejection even when the temporary adapter is selected.
const temporaryAdapter = makeInMemoryAdapter();
const adapterPromise = resolveReaderStorage({ getDirectory: () => rootHandlePromise }).then((mode) => {
  if (mode === "opfs") return persistedAdapter;
  console.warn("[wiki-vite] Persistent cache unavailable; using temporary reader storage");
  return temporaryAdapter;
});

function BootRetryPending() {
  return (
    <WikiPageLoading
      data-test-id="store-boot-retry"
      includeTags
      label="Loading page"
    />
  );
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

export function LiveStoreRoot({
  identity,
  scope,
}: {
  identity: WikiSessionIdentity;
  scope: WikiScope;
}) {
  const storeId = makeWikiStoreId({
    siteSlug: identity.siteSlug,
    scope,
    origin: window.location.origin,
    cacheKey: identity.cacheKey,
  });
  // Reset adapter choice, deadlines, and retry budget together on identity
  // changes. Never let a prior session's delayed callback replace this store.
  return <ReaderStore key={storeId} storeId={storeId} identity={identity} scope={scope} />;
}

function ReaderStore({ identity, scope, storeId }: {
  identity: WikiSessionIdentity;
  scope: WikiScope;
  storeId: string;
}) {
  const boot = useMemo(() => createReaderBoot(identity), [identity]);
  const [adapter, setAdapter] = useState<Awaited<typeof adapterPromise> | null>(null);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    let active = true;
    void adapterPromise.then((resolved) => {
      // A late probe must not replace a temporary store already in use.
      if (active) setAdapter((current: Awaited<typeof adapterPromise> | null) => current ?? resolved);
    });
    return () => { active = false; };
  }, []);
  const [bootAttempt, setBootAttempt] = useState(0);
  const retryBoot = useCallback(() => setBootAttempt((attempt) => attempt + 1), []);
  const recoverStalledBoot = useCallback(() => {
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

  if (stalled) return <StoreStartupRecovery />;
  if (!adapter) return <StoreStartupLoading onTimeout={recoverStalledBoot} />;

  return (
    <StoreBootRetryBoundary key={`${adapter === temporaryAdapter}:${bootAttempt}`} attempt={bootAttempt} onRetry={retryBoot}>
      <LiveStoreProvider
        boot={boot}
        key={bootAttempt}
        schema={schema}
        adapter={adapter}
        batchUpdates={batchUpdates}
        storeId={storeId}
        disableDevtools={!liveStoreDevtoolsEnabled}
        renderLoading={({ stage }) => (
          <StoreStartupLoading
            label={`Loading page (${stage})`}
            onTimeout={recoverStalledBoot}
          />
        )}
        renderShutdown={() => <StoreStartupRecovery />}
        renderError={(error) => (
          <StoreBootError error={error} attempt={bootAttempt} onRetry={retryBoot} />
        )}
      >
        <WikiSessionProvider identity={identity}>
          <WikiScopeProvider scope={scope}>
            <SessionCacheRetirement identity={identity} scope={scope} />
            <FirstFrameSnapshotSync identity={identity} scope={scope} />
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
      </LiveStoreProvider>
    </StoreBootRetryBoundary>
  );
}
