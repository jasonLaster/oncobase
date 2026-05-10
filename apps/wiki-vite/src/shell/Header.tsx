import { useStore } from "@livestore/react";
import type { WikiScope } from "@diana-tnbc/wiki-content";
import {
  CommandIcon,
  FileTextIcon,
  MessageCircleIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { pageIndex$ } from "../livestore/queries";
import type { Metrics, PageIndexRow } from "../types";
import { backendHref, hrefForSlug, rememberSlug, returnToHref } from "../wiki-utils";
import { CommandPalette, type PaletteMode } from "./CommandPalette";

export function Header({ scope, metrics }: { scope: WikiScope; metrics: Metrics }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("pages");
  const location = useLocation();
  const returnTo = returnToHref(location.pathname, location.search, location.hash);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteMode(event.shiftKey ? "actions" : "pages");
        setPaletteOpen(true);
      }

      if (event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setPaletteMode("outline");
        setPaletteOpen(true);
      }

      if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setPaletteMode("debug");
        setPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <header className="topbar" data-test-id="app-header">
        <div className="header-left">
          <Link className="brand" to="/" aria-label="Home">
            <span className="brand-mark">D</span>
            <span className="brand-label">Diana Wiki</span>
          </Link>
        </div>
        <div className="header-center">
          <SearchBox />
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="topbar-button"
            data-test-id="command-palette-trigger"
            onClick={() => {
              setPaletteMode("pages");
              setPaletteOpen(true);
            }}
          >
            <CommandIcon size={15} aria-hidden="true" />
            <span>Palette</span>
          </button>
          <a className="topbar-button" href={backendHref("/search", { returnTo })}>
            <SearchIcon size={15} aria-hidden="true" />
            <span>Search</span>
          </a>
          <a className="topbar-button primary" href={backendHref("/chat", { returnTo })}>
            <MessageCircleIcon size={15} aria-hidden="true" />
            <span>New Chat</span>
          </a>
        </div>
        <div className="topbar-status">
          <ScopeSwitcher
            hash={location.hash}
            pathname={location.pathname}
            scope={scope}
            search={location.search}
          />
          <span className={`sync-dot ${metrics.status}`} />
          <span>{metrics.message}</span>
        </div>
      </header>
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

function ScopeSwitcher({
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

function SearchBox() {
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = returnToHref(location.pathname, location.search, location.hash);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pages.slice(0, 8);
    return pages
      .filter((page) =>
        `${page.title} ${page.slug} ${page.tagsJson}`.toLowerCase().includes(normalized),
      )
      .slice(0, 12);
  }, [pages, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="search-shell">
      <SearchIcon size={16} aria-hidden="true" />
      <input
        aria-label="Find cached pages"
        data-slot="command-input"
        data-test-id="header-search-input"
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results[0]) {
            rememberSlug(results[0].slug);
            navigate(hrefForSlug(results[0].slug));
            setQuery("");
          }
        }}
        placeholder="Find cached pages"
      />
      {query ? (
        <div className="search-results">
          {results.length === 0 ? (
            <div className="search-empty">
              <span>No local matches</span>
              <a href={backendHref("/search", { q: query, returnTo })}>Search backend</a>
            </div>
          ) : (
            <>
              {results.map((page) => (
                <Link
                  key={page.slug}
                  to={hrefForSlug(page.slug)}
                  onClick={() => setQuery("")}
                >
                  <FileTextIcon size={14} aria-hidden="true" />
                  <span>{page.title}</span>
                  <small>{page.slug}</small>
                </Link>
              ))}
              <a className="backend-search-result" href={backendHref("/search", { q: query, returnTo })}>
                <SearchIcon size={14} aria-hidden="true" />
                <span>Search backend</span>
                <small>{query}</small>
              </a>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
