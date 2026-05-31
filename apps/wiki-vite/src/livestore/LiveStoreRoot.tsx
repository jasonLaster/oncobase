import { makePersistedAdapter } from "@livestore/adapter-web";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { LiveStoreProvider } from "@livestore/react";
import { makeWikiStoreId, type WikiScope, type WikiSessionIdentity } from "@oncobase/wiki-content";
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
        <div className="app-loading">Opening local wiki cache ({stage})...</div>
      )}
      renderError={(error) => (
        <div className="app-loading app-error">LiveStore failed: {String(error)}</div>
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
