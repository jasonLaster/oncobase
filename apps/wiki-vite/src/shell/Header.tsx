import type { WikiScope } from "@oncobase/wiki-content";
import {
  WikiActionsMenu,
  applyWikiTheme,
  cycleWikiThemePreference,
  getWikiThemePreference,
  subscribeWikiSystemTheme,
  subscribeWikiThemePreference,
  wikiThemeLabel,
  type WikiActionsMenuAuthInput,
  type WikiActionsMenuProps,
  type WikiActionsMenuUser,
} from "@oncobase/wiki-shell";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation } from "react-router";
import { backendHref, returnToHref } from "../wiki-utils";
import type { PaletteMode } from "./CommandPalette";

const OPEN_COMMAND_PALETTE_EVENT = "wiki-vite-open-command-palette";

const CommandPalette = lazy(() =>
  import("./CommandPalette").then((module) => ({
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;

      if (!event.shiftKey && event.code === "KeyK") {
        event.preventDefault();
        openPalette("pages");
      }

      if (!event.shiftKey && event.code === "KeyO") {
        event.preventDefault();
        openPalette("pages");
      }

      if (event.shiftKey && event.code === "KeyO") {
        event.preventDefault();
        openPalette("outline");
      }

      if (event.shiftKey && event.code === "KeyK") {
        event.preventDefault();
        openPalette("actions");
      }

      if (event.shiftKey && event.code === "KeyD") {
        event.preventDefault();
        openPalette("debug");
      }
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [openPalette]);

  return paletteOpen ? (
    <Suspense fallback={null}>
      <CommandPalette
        open={paletteOpen}
        initialMode={paletteMode}
        onOpenChange={setPaletteOpen}
      />
    </Suspense>
  ) : null;
}

export function useWikiViteAuth() {
  const [sessionUser, setSessionUser] = useState<WikiActionsMenuUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setSessionLoading(true);
      try {
        const response = await fetch(backendHref("/api/auth/session"), {
          credentials: "same-origin",
        });
        const data = await response.json();
        if (!cancelled) setSessionUser(data.user ?? null);
      } catch {
        if (!cancelled) setSessionUser(null);
      } finally {
        if (!cancelled) setSessionLoading(false);
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

  async function parseAuthResponse(response: Response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Something went wrong");
    }
    return data as { user?: WikiActionsMenuUser };
  }

  async function submitAuth(input: WikiActionsMenuAuthInput) {
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
  }

  async function signOut() {
    await fetch(backendHref("/api/auth/signout"), {
      method: "POST",
      credentials: "same-origin",
    });
    window.dispatchEvent(new CustomEvent("wiki-auth-session-change"));
  }

  return {
    sessionLoading,
    sessionUser,
    setSessionUser,
    signOut,
    submitAuth,
  };
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
      onOpenCommandPalette={() => openCommandPalette("actions")}
      onSessionChange={setSessionUser}
      onSignOut={signOut}
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
