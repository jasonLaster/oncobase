import {
  createWikiContentClient,
  type WikiScope,
  type WikiSessionIdentity,
} from "@oncobase/wiki-content";
import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import { createElement, lazy, Suspense, useEffect, useState } from "react";
import { persistPublicIdentity, resolvePublicIdentityFallback } from "./public-identity";
import { explicitReaderScope, resolveReaderSession } from "./reader-session";
import { WikiIdentityPendingContext } from "./wiki-context";

function readScope(): WikiScope {
  // A public cache may paint while identity is checked, but it never decides
  // whether the authenticated reader is allowed to load session content.
  return explicitReaderScope(window.location.search) ?? "public";
}

const loadLiveStoreRoot = () =>
  import("./livestore/LiveStoreRoot").then((module) => ({
    default: module.LiveStoreRoot,
  }));
const LiveStoreRoot = lazy(loadLiveStoreRoot);
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

function publicIdentityPartition() {
  const apiOrigin = new URL(
    apiBaseUrl() || window.location.origin,
    window.location.origin,
  ).origin;
  return `${window.location.origin}|${apiOrigin}`;
}

function publicIdentityFallback(scope: WikiScope) {
  if (scope !== "public") return null;
  try {
    return resolvePublicIdentityFallback({
      storage: window.localStorage,
      partition: publicIdentityPartition(),
      configuredSiteSlug: import.meta.env.VITE_WIKI_SITE_SLUG,
    });
  } catch {
    return null;
  }
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

export function WikiViteRoot() {
  const [identityPending, setIdentityPending] = useState(true);
  const [state, setState] = useState<BootstrapState>(() => {
    const scope = readScope();
    const fallback = publicIdentityFallback(scope);
    return fallback
      ? { status: "ready", scope, identity: fallback }
      : { status: "loading", scope };
  });

  useEffect(() => {
    let cancelled = false;
    // Download/initialize the reader while identity is verified. Importing code
    // does not open a store or authorize content; those still require identity.
    void loadLiveStoreRoot().catch(() => undefined);
    const scope = readScope();
    const fallback = publicIdentityFallback(scope);
    if (!fallback) setState({ status: "loading", scope });
    const baseUrl = apiBaseUrl();
    void resolveReaderSession(
      explicitReaderScope(window.location.search),
      (requestedScope) => createWikiContentClient({
        scope: requestedScope,
        baseUrl,
        credentials: baseUrl ? "include" : "same-origin",
        requestTimeoutMs: 30_000,
      }).fetchSessionIdentity(),
    )
      .then((identity) => {
        if (!cancelled) {
          setIdentityPending(false);
          if (identity.scope === "public") {
            try {
              persistPublicIdentity(
                window.localStorage,
                publicIdentityPartition(),
                identity,
              );
            } catch {
              // localStorage can be disabled independently of OPFS.
            }
          }
          setState({ status: "ready", scope: identity.scope, identity });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setIdentityPending(false);
          if (scope === "public" && fallback) {
            setState({ status: "ready", scope, identity: fallback });
            return;
          }
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
    createElement(
      WikiIdentityPendingContext.Provider,
      { value: identityPending },
      createElement(LiveStoreRoot, { identity: state.identity, scope: state.scope }),
    ),
  );
}
