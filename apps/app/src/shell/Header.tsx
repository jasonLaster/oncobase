import type { WikiScope } from "@oncobase/wiki-content";
import {
  WikiActionsMenu,
  WikiAuthDialog,
  WIKI_AUTH_DIALOG_EVENT,
  applyWikiTheme,
  cycleWikiThemePreference,
  getWikiThemePreference,
  createCommandPaletteChords,
  subscribeWikiSystemTheme,
  subscribeWikiThemePreference,
  wikiThemeLabel,
  type WikiActionsMenuAuthInput,
  type WikiActionsMenuAuthMode,
  type WikiActionsMenuProps,
  type WikiActionsMenuUser,
} from "@oncobase/wiki-shell";
import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { backendHref, returnToHref } from "../wiki-utils";
import { requestSessionCacheCleanup } from "../livestore/cache-retirement";
import { useWikiSession } from "../wiki-context";
import type { PaletteMode } from "./CommandPalette";
import type {} from "../bootstrap/reader-shortcuts";

const OPEN_COMMAND_PALETTE_EVENT = "wiki-vite-open-command-palette";

const loadCommandPalette = () => import("./CommandPalette");
const CommandPalette = lazy(() =>
  loadCommandPalette().then((module) => ({
    default: module.CommandPalette,
  })),
);

export function openCommandPalette(mode: PaletteMode = "pages") {
  window.dispatchEvent(
    new CustomEvent<{ mode: PaletteMode }>(OPEN_COMMAND_PALETTE_EVENT, {
      detail: { mode },
    }),
  );
}

export function HeaderCommandPaletteHost() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("pages");
  const [PreparedPalette, setPreparedPalette] = useState<typeof import("./CommandPalette").CommandPalette | null>(null);

  useEffect(() => {
    // Fetch the split chunk once the interactive shell is mounted, before the
    // first shortcut. Mounting the palette still waits for an explicit request.
    // A speculative failure must not break the reader; lazy loading retains the
    // normal asset recovery path when the user actually opens the palette.
    let cancelled = false;
    void loadCommandPalette().then(module => {
      if (!cancelled) setPreparedPalette(() => module.CommandPalette);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const openPalette = useCallback((mode: PaletteMode) => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  }, []);

  useEffect(() => {
    const onOpenPalette = (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: PaletteMode }>;
      openPalette(customEvent.detail?.mode ?? "pages");
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenPalette);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenPalette);
  }, [openPalette]);

  useEffect(() => {
    const early = window.__wikiReaderShortcuts;
    const shortcuts = early?.controller ?? createCommandPaletteChords({});
    const openSignIn = () => window.dispatchEvent(new CustomEvent(WIKI_AUTH_DIALOG_EVENT, { detail: { mode: "signin" } }));
    shortcuts.setHandlers({
      onFiles: () => openPalette("pages"),
      onOutline: () => openPalette("outline"),
      onAction: () => openPalette("actions"),
      onSignIn: openSignIn,
    });
    delete window.__wikiReaderShortcuts;
    if (early?.pending === "signin") openSignIn();
    else if (early?.pending) openCommandPalette(early.pending);
    return shortcuts.dispose;
  }, [openPalette]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey || event.code !== "KeyD") return;
      event.preventDefault();
      openPalette("debug");
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [openPalette]);

  const Palette = PreparedPalette ?? CommandPalette;
  return paletteOpen ? (
    <Suspense fallback={null}>
      <Palette
        open={paletteOpen}
        initialMode={paletteMode}
        onOpenChange={setPaletteOpen}
      />
    </Suspense>
  ) : null;
}

export function HeaderAuthDialogHost() {
  const { setSessionUser, submitAuth } = useWikiViteAuth();
  const [authDialogOpen, setAuthDialogOpen] = useState(() => window.__wikiReaderShortcuts?.pending === "signin" || new URLSearchParams(location.search).get("reader-action") === "signin");
  const [authMode, setAuthMode] =
    useState<WikiActionsMenuAuthMode>("signin");

  useEffect(() => {
    const onOpenAuthDialog = (event: Event) => {
      const customEvent = event as CustomEvent<{
        mode?: WikiActionsMenuAuthMode;
      }>;
      setAuthMode(customEvent.detail?.mode ?? "signin");
      setAuthDialogOpen(true);
    };

    window.addEventListener(WIKI_AUTH_DIALOG_EVENT, onOpenAuthDialog);
    return () =>
      window.removeEventListener(WIKI_AUTH_DIALOG_EVENT, onOpenAuthDialog);
  }, []);

  return (
    <WikiAuthDialog
      initialMode={authMode}
      onAuthSubmit={submitAuth}
      onClose={() => setAuthDialogOpen(false)}
      onSessionChange={setSessionUser}
      open={authDialogOpen}
    />
  );
}

const WikiAuthContext = createContext<ReturnType<typeof useWikiAuthState> | null>(null);

export function WikiAuthProvider({ children }: { children: ReactNode }) {
  const auth = useWikiAuthState();
  return <WikiAuthContext.Provider value={auth}>{children}</WikiAuthContext.Provider>;
}

export function useWikiViteAuth() {
  const auth = useContext(WikiAuthContext);
  if (!auth) throw new Error("Wiki authentication must be read inside WikiAuthProvider");
  return auth;
}

function useWikiAuthState() {
  const [sessionUser, setSessionUser] = useState<WikiActionsMenuUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let requestVersion = 0;

    async function loadSession() {
      const version = ++requestVersion;
      setSessionLoading(true);
      try {
        const response = await fetch(backendHref("/api/auth/session"), {
          credentials: "same-origin",
        });
        const data = await response.json();
        if (!cancelled && version === requestVersion) setSessionUser(data.user ?? null);
      } catch {
        if (!cancelled && version === requestVersion) setSessionUser(null);
      } finally {
        if (!cancelled && version === requestVersion) setSessionLoading(false);
      }
    }

    loadSession();
    const onSessionChange = () => loadSession();
    window.addEventListener("wiki-auth-session-change", onSessionChange);
    return () => {
      cancelled = true;
      window.removeEventListener("wiki-auth-session-change", onSessionChange);
    };
  }, []);

  const parseAuthResponse = useCallback(async (response: Response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Something went wrong");
    }
    return data as { user?: WikiActionsMenuUser };
  }, []);

  const submitAuth = useCallback(async (input: WikiActionsMenuAuthInput) => {
    const response = await fetch(
      backendHref(input.mode === "signup" ? "/api/auth/signup" : "/api/auth/signin"),
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          input.mode === "signup"
            ? { name: input.name, email: input.email, password: input.password }
            : { email: input.email, password: input.password },
        ),
      },
    );
    const data = await parseAuthResponse(response);
    if (!data.user) throw new Error("The server did not return a user session");
    window.dispatchEvent(new CustomEvent("wiki-auth-session-change"));
    return data.user;
  }, [parseAuthResponse]);

  const signOut = useCallback(async () => {
    await fetch(backendHref("/api/auth/signout"), {
      method: "POST",
      credentials: "same-origin",
    });
    window.dispatchEvent(new CustomEvent("wiki-auth-session-change"));
  }, []);

  return useMemo(() => ({
    sessionLoading,
    sessionUser,
    setSessionUser,
    signOut,
    submitAuth,
  }), [sessionLoading, sessionUser, signOut, submitAuth]);
}

export function ViteActionsMenu({ trigger }: { trigger?: WikiActionsMenuProps["trigger"] } = {}) {
  const { sessionLoading, sessionUser, setSessionUser, signOut, submitAuth } =
    useWikiViteAuth();
  const preference = useSyncExternalStore(
    subscribeWikiThemePreference,
    getWikiThemePreference,
    () => null,
  );
  const currentTheme = useSyncExternalStore<"dark" | "light">(
    useCallback(
      (callback: () => void) =>
        subscribeWikiSystemTheme(() => {
          applyWikiTheme();
          callback();
        }),
      [],
    ),
    applyWikiTheme,
    () => "light",
  );
  const location = useLocation();
  const navigate = useNavigate();
  const identity = useWikiSession();
  const returnTo = returnToHref(location.pathname, location.search, location.hash);
  const scope = (() => {
    const urlScope = new URLSearchParams(location.search).get("scope");
    if (urlScope === "session" || urlScope === "public") return urlScope;
    return window.localStorage.getItem("wiki-vite-scope") === "session" ? "session" : "public";
  })();

  return (
    <WikiActionsMenu
      adminHref="/admin"
      currentTheme={currentTheme}
      downloadFullHref={backendHref("/api/download", { type: "full", scope })}
      downloadMarkdownHref={backendHref("/api/download", { type: "markdown", scope })}
      hideSignedOutAccountActions
      onAuthSubmit={submitAuth}
      onNavigate={(href) => {
        const url = new URL(href, window.location.href);
        if (url.origin === window.location.origin) {
          navigate(`${url.pathname}${url.search}${url.hash}`);
          return;
        }
        window.location.assign(url);
      }}
      onOpenCommandPalette={() => openCommandPalette("actions")}
      onSessionChange={setSessionUser}
      onSignOut={async () => {
        await signOut();
        if (identity?.siteSlug) {
          requestSessionCacheCleanup(
            window.localStorage,
            identity.siteSlug,
          );
        }
        window.localStorage.setItem("wiki-vite-scope", "public");
        window.location.reload();
      }}
      onThemeToggle={cycleWikiThemePreference}
      searchHref={backendHref("/search", { returnTo })}
      sessionLoading={sessionLoading}
      sessionUser={sessionUser}
      textSearchHref={backendHref("/search", { returnTo, tab: "text" })}
      themeLabel={wikiThemeLabel(preference)}
      trigger={trigger}
    />
  );
}

function scopeHref(pathname: string, search: string, hash: string, scope: WikiScope) {
  const params = new URLSearchParams(search);
  params.set("scope", scope);
  return `${pathname}?${params.toString()}${hash}`;
}

export function ScopeSwitcher({
  hash,
  pathname,
  scope,
  search,
}: {
  hash: string;
  pathname: string;
  scope: WikiScope;
  search: string;
}) {
  return (
    <div className="scope-switcher" data-test-id="scope-switcher" aria-label="Reader cache scope">
      <a
        className={scope === "public" ? "active" : ""}
        href={scopeHref(pathname, search, hash, "public")}
        onClick={() => window.localStorage.setItem("wiki-vite-scope", "public")}
      >
        Public
      </a>
      <a
        className={scope === "session" ? "active" : ""}
        href={scopeHref(pathname, search, hash, "session")}
        onClick={() => window.localStorage.setItem("wiki-vite-scope", "session")}
      >
        Session
      </a>
    </div>
  );
}
