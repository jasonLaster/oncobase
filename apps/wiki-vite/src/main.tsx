import { makePersistedAdapter } from "@livestore/adapter-web";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { LiveStoreProvider } from "@livestore/react";
import { makeWikiStoreId, type WikiScope } from "@diana-tnbc/wiki-content";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";
import { BrowserRouter } from "react-router";
import { App, WikiScopeProvider } from "./App";
import LiveStoreWorker from "./livestore/livestore.worker?worker";
import { schema } from "./livestore/schema";
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

const scope = readScope();
const siteSlug = import.meta.env.VITE_WIKI_SITE_SLUG ?? "diana";
const storeId = makeWikiStoreId({
  siteSlug,
  scope,
  origin: window.location.origin,
});
const adapter = makePersistedAdapter({
  storage: { type: "opfs" },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
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
      <WikiScopeProvider scope={scope}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </WikiScopeProvider>
    </LiveStoreProvider>
  </StrictMode>,
);
