import { makePersistedAdapter } from "@livestore/adapter-web";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { LiveStoreProvider } from "@livestore/react";
import {
  createWikiContentClient,
  makeWikiStoreId,
  type WikiScope,
  type WikiSessionIdentity,
} from "@diana-tnbc/wiki-content";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import LiveStoreWorker from "./livestore/livestore.worker?worker";
import { schema } from "./livestore/schema";
import { WikiScopeProvider, WikiSessionProvider } from "./wiki-context";
import "./styles.css";

function readScope(): WikiScope {
  const url = new URL(window.location.href);
  const urlScope = url.searchParams.get("scope");
  if (urlScope === "session" || urlScope === "public") {
    window.localStorage.setItem("wiki-vite-scope", urlScope);
    return urlScope;
  }
  return window.localStorage.getItem("wiki-vite-scope") === "session"
    ? "session"
    : "public";
}

const adapter = makePersistedAdapter({
  storage: { type: "opfs" },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
});

type BootstrapState =
  | { status: "loading"; scope: WikiScope }
  | { status: "ready"; scope: WikiScope; identity: WikiSessionIdentity }
  | { status: "error"; scope: WikiScope; message: string };

function WikiViteRoot() {
  const [state, setState] = useState<BootstrapState>(() => ({
    status: "loading",
    scope: readScope(),
  }));

  useEffect(() => {
    let cancelled = false;
    const scope = readScope();
    setState({ status: "loading", scope });
    const client = createWikiContentClient({ scope });

    void client.fetchSessionIdentity()
      .then((identity) => {
        if (!cancelled) setState({ status: "ready", scope, identity });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            scope,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const storeId = useMemo(() => {
    if (state.status !== "ready") return null;
    return makeWikiStoreId({
      siteSlug: state.identity.siteSlug,
      scope: state.scope,
      origin: window.location.origin,
      cacheKey: state.identity.cacheKey,
    });
  }, [state]);

  if (state.status === "loading") {
    return <div className="app-loading">Opening wiki session...</div>;
  }

  if (state.status === "error") {
    return (
      <div className="app-loading app-error">
        Wiki session failed: {state.message}
      </div>
    );
  }

  if (!storeId) {
    return <div className="app-loading">Opening wiki session...</div>;
  }

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      batchUpdates={batchUpdates}
      storeId={storeId}
      renderLoading={({ stage }) => (
        <div className="app-loading">Opening local wiki cache ({stage})...</div>
      )}
      renderError={(error) => (
        <div className="app-loading app-error">LiveStore failed: {String(error)}</div>
      )}
    >
      <WikiSessionProvider identity={state.identity}>
        <WikiScopeProvider scope={state.scope}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WikiScopeProvider>
      </WikiSessionProvider>
    </LiveStoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WikiViteRoot />
  </StrictMode>,
);
