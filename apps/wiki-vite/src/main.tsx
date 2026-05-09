import {
  createWikiContentClient,
  type WikiScope,
  type WikiSessionIdentity,
} from "@diana-tnbc/wiki-content";
import { createElement, lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
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

const LiveStoreRoot = lazy(() =>
  import("./livestore/LiveStoreRoot").then((module) => ({
    default: module.LiveStoreRoot,
  })),
);

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

  if (state.status === "loading") {
    return createElement("div", { className: "app-loading" }, "Opening wiki session...");
  }

  if (state.status === "error") {
    return createElement(
      "div",
      { className: "app-loading app-error" },
      `Wiki session failed: ${state.message}`,
    );
  }

  return createElement(
    Suspense,
    {
      fallback: createElement(
        "div",
        { className: "app-loading" },
        "Opening local wiki cache...",
      ),
    },
    createElement(LiveStoreRoot, { identity: state.identity, scope: state.scope }),
  );
}

createRoot(document.getElementById("root")!).render(
  createElement(StrictMode, null, createElement(WikiViteRoot)),
);
