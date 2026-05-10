import type { WikiScope } from "@diana-tnbc/wiki-content";
import {
  WikiHeader,
  WikiHeaderButton,
  WikiHeaderLink,
  WikiHeaderSearchForm,
  WikiLogo,
} from "@diana-tnbc/wiki-shell";
import {
  CommandIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { backendHref, returnToHref } from "../wiki-utils";
import { CommandPalette, type PaletteMode } from "./CommandPalette";

export function Header() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("pages");
  const [searchQuery, setSearchQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = returnToHref(location.pathname, location.search, location.hash);

  const openPalette = (mode: PaletteMode) => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette(event.shiftKey ? "actions" : "pages");
      }

      if (event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        openPalette("outline");
      }

      if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        openPalette("debug");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
        }
        actions={
          <>
            <WikiHeaderLink
              data-test-id="header-new-chat"
              href={backendHref("/chat", { returnTo })}
              variant="primary"
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
            <WikiHeaderButton
              aria-label="Actions"
              title="Actions"
              data-test-id="header-actions-menu"
              onClick={() => openPalette("actions")}
              variant="icon"
            >
              <MoreHorizontalIcon size={16} aria-hidden="true" />
            </WikiHeaderButton>
          </>
        }
      />
      <CommandPalette
        open={paletteOpen}
        initialMode={paletteMode}
        onOpenChange={setPaletteOpen}
      />
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
