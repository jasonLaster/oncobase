import { useStore } from "@livestore/react";
import type { WikiScope } from "@diana-tnbc/wiki-content";
import {
  CommandIcon,
  FileTextIcon,
  MessageCircleIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { pageIndex$ } from "../livestore/queries";
import type { Metrics, PageIndexRow } from "../types";
import { backendHref, hrefForSlug, rememberSlug } from "../wiki-utils";
import { CommandPalette } from "./CommandPalette";

export function Header({ scope, metrics }: { scope: WikiScope; metrics: Metrics }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"pages" | "outline" | "actions">("pages");

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
          <a className="topbar-button" href={backendHref("/search")}>
            <SearchIcon size={15} aria-hidden="true" />
            <span>Search</span>
          </a>
          <a className="topbar-button primary" href={backendHref("/chat")}>
            <MessageCircleIcon size={15} aria-hidden="true" />
            <span>New Chat</span>
          </a>
        </div>
        <div className="topbar-status">
          <span className={`scope-pill ${scope === "session" ? "session" : ""}`}>
            {scope}
          </span>
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

function SearchBox() {
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
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
            <div className="search-empty">No local matches</div>
          ) : (
            results.map((page) => (
              <Link
                key={page.slug}
                to={hrefForSlug(page.slug)}
                onClick={() => setQuery("")}
              >
                <FileTextIcon size={14} aria-hidden="true" />
                <span>{page.title}</span>
                <small>{page.slug}</small>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
