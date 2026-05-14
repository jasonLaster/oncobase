import type { WikiScope } from "@diana-tnbc/wiki-content";
import {
  WikiActionsMenu,
  WikiHeader,
  WikiHeaderButton,
  WikiHeaderLink,
  WikiHeaderSearchForm,
  WikiLogo,
  applyWikiTheme,
  cycleWikiThemePreference,
  getWikiThemePreference,
  subscribeWikiSystemTheme,
  subscribeWikiThemePreference,
  wikiThemeLabel,
  type WikiActionsMenuAuthInput,
  type WikiActionsMenuUser,
} from "@diana-tnbc/wiki-shell";
import { CommandIcon, MessageCircleIcon } from "lucide-react";
import {
  Suspense,
  lazy,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { backendHref, returnToHref } from "../wiki-utils";
import type { PaletteMode } from "./CommandPalette";

const CommandPalette = lazy(() =>
  import("./CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);

export function Header() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("pages");
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionUser, setSessionUser] = useState<WikiActionsMenuUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
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
  const returnTo = returnToHref(location.pathname, location.search, location.hash);
  const scope = (() => {
    const urlScope = new URLSearchParams(location.search).get("scope");
    if (urlScope === "session" || urlScope === "public") return urlScope;
    return window.localStorage.getItem("wiki-vite-scope") === "session" ? "session" : "public";
  })();

  const openPalette = (mode: PaletteMode) => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  };

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
  }, []);

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

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams({ returnTo });
    const trimmed = searchQuery.trim();
    if (trimmed) params.set("q", trimmed);
    navigate(`/search?${params.toString()}`);
  };

  return (
    <>
      <WikiHeader
        data-test-id="app-header"
        home={
          <Link to="/" aria-label="Home" data-test-id="header-home">
            <WikiLogo />
          </Link>
        }
        search={
          <div className="wiki-shell-header-primary-controls">
            <WikiHeaderSearchForm
              action={backendHref("/search")}
              method="get"
              onSubmit={submitSearch}
              inputProps={{
                value: searchQuery,
                onChange: (event) => setSearchQuery(event.currentTarget.value),
                onKeyDown: (event) => event.stopPropagation(),
              }}
            >
              <input type="hidden" name="returnTo" value={returnTo} />
            </WikiHeaderSearchForm>
            <WikiHeaderLink
              data-test-id="header-new-chat"
              href={backendHref("/chat", { returnTo })}
            >
              <MessageCircleIcon size={14} aria-hidden="true" />
              <span>New chat</span>
            </WikiHeaderLink>
            <WikiHeaderButton
              aria-label="Find files (⌘K)"
              title="Find files (⌘K)"
              data-test-id="command-palette-trigger"
              onClick={() => openPalette("pages")}
            >
              <CommandIcon size={14} aria-hidden="true" />
              <span>Find files</span>
            </WikiHeaderButton>
          </div>
        }
        actions={
          <WikiActionsMenu
            currentTheme={currentTheme}
            downloadFullHref={backendHref("/api/download", { type: "full", scope })}
            downloadMarkdownHref={backendHref("/api/download", { type: "markdown", scope })}
            onAuthSubmit={submitAuth}
            onOpenCommandPalette={() => openPalette("actions")}
            onSessionChange={setSessionUser}
            onSignOut={signOut}
            onThemeToggle={cycleWikiThemePreference}
            searchHref={backendHref("/search", { returnTo })}
            sessionLoading={sessionLoading}
            sessionUser={sessionUser}
            textSearchHref={backendHref("/search", { returnTo, tab: "text" })}
            themeLabel={wikiThemeLabel(preference)}
          />
        }
      />
      {paletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            initialMode={paletteMode}
            onOpenChange={setPaletteOpen}
          />
        </Suspense>
      ) : null}
    </>
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
