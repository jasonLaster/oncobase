import {
  createWikiContentClient,
  type WikiScope,
  type WikiSessionIdentity,
} from "@oncobase/wiki-content";
import { createElement, Suspense, useEffect, useState } from "react";
import { persistPublicIdentity, resolvePublicIdentityFallback } from "./public-identity";
import { explicitReaderScope, resolveReaderSession } from "./reader-session";
import { WikiIdentityPendingContext } from "./wiki-context";
import { markVisualPhase } from "./visual-phase";
import { AppStarting } from "./AppStarting";
import { publicIdentityFromPageBootstrap } from "./bootstrap/public-identity";
import { PAGE_BOOTSTRAP_ID, MAX_BOOTSTRAP_BYTES } from "./bootstrap/page-payload";
import { mayContainMath, preloadMarkdownMath } from "@oncobase/wiki-markdown/math-loader";

function readScope(): WikiScope {
  // A public cache may paint while identity is checked, but it never decides
  // whether the authenticated reader is allowed to load session content.
  return explicitReaderScope(window.location.search) ?? "public";
}

// Track module readiness explicitly: React.lazy can suspend even after this
// preload resolves, adding another fallback reveal delay before store startup.
const loadLiveStoreRoot = () =>
  import("./livestore/LiveStoreRoot").then((module) => ({
    default: module.LiveStoreRoot,
  }));
type ReaderComponent = Awaited<ReturnType<typeof loadLiveStoreRoot>>["default"];
type ReaderModuleState =
  | { status: "loading" }
  | { status: "ready"; Component: ReaderComponent }
  | { status: "error"; error: Error };
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

function publicIdentityFromResponse() {
  const payload = document.getElementById(PAGE_BOOTSTRAP_ID);
  return payload && publicIdentityFromPageBootstrap(
    payload.textContent ?? "", Number(payload.dataset.receivedAt), {
      origin: location.origin, pathname: location.pathname,
      apiOrigin: new URL(apiBaseUrl() || location.origin, location.origin).origin,
      scope: explicitReaderScope(location.search),
      configuredSiteSlug: import.meta.env.VITE_WIKI_SITE_SLUG,
    },
  );
}

function publicIdentityFallback(scope: WikiScope) {
  if (scope !== "public") return null;
  try {
    return publicIdentityFromResponse() ?? resolvePublicIdentityFallback({
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
  const [readerModule, setReaderModule] = useState<ReaderModuleState>({ status: "loading" });
  const [identityPending, setIdentityPending] = useState(true);
  const [state, setState] = useState<BootstrapState>(() => {
    const scope = readScope();
    const initial = publicIdentityFromResponse();
    const fallback = initial ?? publicIdentityFallback(scope);
    // Browser caches never choose automatic scope. A fresh private response
    // may already have verified that this request has no account session.
    return fallback && (initial || explicitReaderScope(window.location.search) === "public")
      ? { status: "ready", scope, identity: fallback }
      : { status: "loading", scope };
  });

  useEffect(() => {
    let cancelled = false;
    markVisualPhase("identity-start");
    const initialMarkdown = document.getElementById(PAGE_BOOTSTRAP_ID)?.textContent;
    if (initialMarkdown && initialMarkdown.length <= MAX_BOOTSTRAP_BYTES && mayContainMath(initialMarkdown)) {
      // Fetch optional math alongside the reader, before the boot payload paints.
      void preloadMarkdownMath().catch(() => {});
    }
    // Download/initialize the reader while identity is verified. Importing code
    // does not open a store or authorize content; those still require identity.
    void loadLiveStoreRoot()
      .then((module) => {
        if (!cancelled) setReaderModule({ status: "ready", Component: module.default });
      })
      .catch((error: unknown) => {
        if (!cancelled) setReaderModule({
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
    const scope = readScope();
    const fallback = publicIdentityFallback(scope);
    const baseUrl = apiBaseUrl();
    void resolveReaderSession(
      explicitReaderScope(window.location.search),
      (requestedScope, fallbackToPublic) => createWikiContentClient({
        scope: requestedScope,
        baseUrl,
        credentials: baseUrl ? "include" : "same-origin",
        requestTimeoutMs: 30_000,
      }).fetchSessionIdentity({ fallbackToPublic,
        profileStartup: new URLSearchParams(window.location.search).get("paintDebug") === "1" }),
    )
      .then((identity) => {
        if (!cancelled) {
          markVisualPhase("identity-ready", { scope: identity.scope });
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
          markVisualPhase("identity-error");
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

  const startingApp = createElement(AppStarting);
  if (state.status === "loading") return startingApp;

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

  if (readerModule.status === "error") throw readerModule.error;
  if (readerModule.status === "loading") return startingApp;

  return createElement(
    Suspense,
    { fallback: startingApp },
    createElement(
      WikiIdentityPendingContext.Provider,
      { value: identityPending },
      createElement(readerModule.Component, { identity: state.identity, scope: state.scope }),
    ),
  );
}
