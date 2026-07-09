import { makePersistedAdapter } from "@livestore/adapter-web";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { LiveStoreProvider } from "@livestore/react";
import { makeWikiStoreId, type WikiScope, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { WikiPageLoading } from "@oncobase/wiki-shell";
import { useMemo } from "react";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";
import { BrowserRouter } from "react-router";
import { App } from "../App";
import { WikiScopeProvider, WikiSessionProvider } from "../wiki-context";
import { readDevtoolsFooterVisible, readLiveStoreDevtoolsEnabled } from "./devtools";
import LiveStoreWorker from "./livestore.worker?worker";
import { schema } from "./schema";

const adapter = makePersistedAdapter({
  storage: { type: "opfs" },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
});

export function LiveStoreRoot({
  identity,
  scope,
}: {
  identity: WikiSessionIdentity;
  scope: WikiScope;
}) {
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
    <LiveStoreProvider
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
        <main className="app-loading app-auth-shell" data-test-id="app-recovery">
          <section>
            <h1>This reader hit a snag</h1>
            <p>
              The local wiki cache could not be opened. Resetting clears the offline copy
              stored in this browser and reloads the latest content.
            </p>
            <p className="auth-error">{String(error)}</p>
          </section>
        </main>
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
  );
}
