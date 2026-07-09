import {
  createWikiContentClient,
  type WikiScope,
  type WikiSessionIdentity,
} from "@oncobase/wiki-content";
import { WikiPageLoading } from "@oncobase/wiki-shell";
import { createElement, lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary, reloadOnceForLoadError } from "./AppErrorBoundary";
import { publishRuntimeEnvironment } from "./observability";
import "./styles.css";

// Vite throws this when a dynamic import's JS/CSS fails to load — most often a
// tab left open across a deploy. Recover by reloading once; if we already
// reloaded this session, let it propagate to the error boundary instead of
// silently swallowing the failure.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceForLoadError()) event.preventDefault();
});

publishRuntimeEnvironment({
  mode: import.meta.env.MODE,
  vercelEnv: import.meta.env.VITE_VERCEL_ENV,
  commitSha: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA,
});

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

function backendHref(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const origin =
    import.meta.env.VITE_WIKI_APP_ORIGIN ?? import.meta.env.VITE_WIKI_API_ORIGIN ?? "";
  return origin ? `${origin.replace(/\/+$/, "")}${normalizedPath}` : normalizedPath;
}

function currentReturnTo() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function apiBaseUrl() {
  return import.meta.env.VITE_WIKI_API_ORIGIN ?? "";
}

function switchToPublicScope() {
  window.localStorage.setItem("wiki-vite-scope", "public");
  const url = new URL(window.location.href);
  url.searchParams.set("scope", "public");
  window.location.assign(`${url.pathname}${url.search}${url.hash}`);
}

function SessionRecovery({ message }: { message: string }) {
  return createElement(
    "main",
    {
      className: "app-loading app-auth-shell",
      "data-test-id": "session-recovery",
    },
    createElement("section", null, [
      createElement("h1", { key: "title" }, "Session access needed"),
      createElement(
        "p",
        { key: "body" },
        "This reader keeps public and session caches separate. Sign in through the main app to use the session store, or continue with the public cache.",
      ),
      createElement("p", { key: "error", className: "auth-error" }, message),
      createElement("div", { key: "actions", className: "auth-actions" }, [
        createElement(
          "button",
          {
            key: "public",
            type: "button",
            onClick: switchToPublicScope,
          },
          "Continue public",
        ),
        createElement(
          "a",
          {
            key: "login",
            href: backendHref(`/login?redirect=${encodeURIComponent(currentReturnTo())}`),
          },
          "Open sign in",
        ),
      ]),
    ]),
  );
}

function WikiViteRoot() {
  const [state, setState] = useState<BootstrapState>(() => ({
    status: "loading",
    scope: readScope(),
  }));

  useEffect(() => {
    let cancelled = false;
    const scope = readScope();
    setState({ status: "loading", scope });
    const baseUrl = apiBaseUrl();
    const client = createWikiContentClient({
      scope,
      baseUrl,
      credentials: baseUrl ? "include" : "same-origin",
      requestTimeoutMs: 30_000,
    });

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
    return createElement(WikiPageLoading, {
      "data-test-id": "page-loading",
      includeTags: true,
      label: "Loading page",
    });
  }

  if (state.status === "error") {
    if (state.scope === "session") {
      return createElement(SessionRecovery, { message: state.message });
    }

    return createElement(
      "main",
      { className: "app-loading app-auth-shell", "data-test-id": "session-recovery" },
      createElement("section", null, [
        createElement("h1", { key: "title" }, "Wiki session failed"),
        createElement(
          "p",
          { key: "body" },
          "The reader could not verify the current wiki session.",
        ),
        createElement("p", { key: "error", className: "auth-error" }, state.message),
      ]),
    );
  }

  return createElement(
    Suspense,
    {
      fallback: createElement(
        WikiPageLoading,
        {
          "data-test-id": "page-loading",
          includeTags: true,
          label: "Loading page",
        },
      ),
    },
    createElement(LiveStoreRoot, { identity: state.identity, scope: state.scope }),
  );
}

createRoot(document.getElementById("root")!).render(
  createElement(
    StrictMode,
    null,
    createElement(AppErrorBoundary, null, createElement(WikiViteRoot)),
  ),
);
