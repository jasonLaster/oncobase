import { makePersistedAdapter } from "@livestore/adapter-web";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { LiveStoreProvider } from "@livestore/react";
import { makeWikiStoreId, type WikiScope, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import { Component, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";
import { BrowserRouter } from "react-router";
import { App } from "../App";
import { WikiScopeProvider, WikiSessionProvider } from "../wiki-context";
import { readDevtoolsFooterVisible, readLiveStoreDevtoolsEnabled } from "./devtools";
import LiveStoreWorker from "./livestore.worker?worker";
import { schema } from "./schema";
import {
  STORE_BOOT_RETRY_DELAY_MS,
  shouldRetryStoreBoot,
  toBootError,
} from "./store-boot-retry";

const adapter = makePersistedAdapter({
  storage: { type: "opfs" },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
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
      this.setState({ error: null });
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
  const [bootAttempt, setBootAttempt] = useState(0);
  const retryBoot = useCallback(() => setBootAttempt((attempt) => attempt + 1), []);
  const storeId = useMemo(
    () =>
      makeWikiStoreId({
        siteSlug: identity.siteSlug,
        scope,
        origin: window.location.origin,
        cacheKey: identity.cacheKey,
      }),
    [identity.cacheKey, identity.siteSlug, scope],
  );
  const liveStoreDevtoolsEnabled = useMemo(() => readLiveStoreDevtoolsEnabled(), []);
  const devtoolsFooterVisible = useMemo(() => readDevtoolsFooterVisible(), []);

  return (
    <StoreBootRetryBoundary attempt={bootAttempt} onRetry={retryBoot}>
      <LiveStoreProvider
        key={bootAttempt}
        schema={schema}
        adapter={adapter}
        batchUpdates={batchUpdates}
        storeId={storeId}
        disableDevtools={!liveStoreDevtoolsEnabled}
        renderLoading={({ stage }) => (
          <WikiPageLoading
            data-test-id="page-loading"
            includeTags
            label={`Loading page (${stage})`}
          />
        )}
        renderError={(error) => (
          <StoreBootError error={error} attempt={bootAttempt} onRetry={retryBoot} />
        )}
      >
        <WikiSessionProvider identity={identity}>
          <WikiScopeProvider scope={scope}>
            <BrowserRouter>
              <App
                devtoolsFooterVisible={devtoolsFooterVisible}
                liveStoreDevtoolsEnabled={liveStoreDevtoolsEnabled}
                storeId={storeId}
              />
            </BrowserRouter>
          </WikiScopeProvider>
        </WikiSessionProvider>
      </LiveStoreProvider>
    </StoreBootRetryBoundary>
  );
}
