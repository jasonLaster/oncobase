import { useStore } from "@livestore/react";
import {
  DownloadIcon,
  FileTextIcon,
  ListIcon,
  MessageCircleIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { pageIndex$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import { backendHref, hrefForSlug, rememberSlug } from "../wiki-utils";

type PaletteMode = "pages" | "outline" | "actions";

type OutlineItem = {
  id: string;
  text: string;
  level: number;
};

type ActionItem = {
  label: string;
  description: string;
  href: string;
  icon: ReactNode;
};

function commandLabel() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘K" : "Ctrl K";
}

function headingText(heading: HTMLElement) {
  return Array.from(heading.childNodes)
    .filter(
      (node) =>
        !(node instanceof HTMLElement && node.classList.contains("heading-anchor")),
    )
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

function collectOutline() {
  const headings = document.querySelectorAll<HTMLElement>(
    '[data-test-id="document-article"] .wiki-markdown h1, [data-test-id="document-article"] .wiki-markdown h2, [data-test-id="document-article"] .wiki-markdown h3, [data-test-id="document-article"] .wiki-markdown h4',
  );

  return Array.from(headings)
    .map((heading) => ({
      id: heading.id,
      text: headingText(heading),
      level: Number(heading.tagName.replace("H", "")),
    }))
    .filter((item) => item.id && item.text);
}

function pageScore(page: PageIndexRow, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 1;

  const title = page.title.toLowerCase();
  const slug = page.slug.toLowerCase();
  const tags = page.tagsJson.toLowerCase();

  if (title === normalized || slug === normalized) return 100;
  if (title.startsWith(normalized)) return 80;
  if (slug.startsWith(normalized)) return 70;
  if (title.includes(normalized)) return 50;
  if (slug.includes(normalized)) return 40;
  if (tags.includes(normalized)) return 25;
  return 0;
}

export function CommandPalette({
  open,
  initialMode = "pages",
  onOpenChange,
}: {
  open: boolean;
  initialMode?: PaletteMode;
  onOpenChange: (open: boolean) => void;
}) {
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState("");
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!open) return;

    setMode(initialMode);
    setQuery("");
    setOutline(collectOutline());
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [initialMode, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  const pageResults = useMemo(() => {
    return pages
      .map((page) => ({ page, score: pageScore(page, query) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.page.title.localeCompare(right.page.title))
      .slice(0, 12)
      .map(({ page }) => page);
  }, [pages, query]);

  const outlineResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return outline.slice(0, 14);
    return outline
      .filter((item) => item.text.toLowerCase().includes(normalized))
      .slice(0, 14);
  }, [outline, query]);

  const actions = useMemo<ActionItem[]>(
    () => [
      {
        label: "Search wiki",
        description: "Open the backend full-text and AI search surface",
        href: backendHref("/search"),
        icon: <SearchIcon size={15} aria-hidden="true" />,
      },
      {
        label: "New chat",
        description: "Continue in the full-stack chat experience",
        href: backendHref("/chat"),
        icon: <MessageCircleIcon size={15} aria-hidden="true" />,
      },
      {
        label: "Download full wiki",
        description: "Use the existing backend download pipeline",
        href: backendHref("/api/download?type=full"),
        icon: <DownloadIcon size={15} aria-hidden="true" />,
      },
    ],
    [],
  );

  const actionResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.description}`.toLowerCase().includes(normalized),
    );
  }, [actions, query]);

  const openPage = (page: PageIndexRow) => {
    rememberSlug(page.slug);
    navigate(hrefForSlug(page.slug));
    onOpenChange(false);
  };

  const openOutline = (item: OutlineItem) => {
    const heading = document.getElementById(item.id);
    window.history.replaceState(null, "", `${location.pathname}#${item.id}`);
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
    onOpenChange(false);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;

    if (mode === "pages" && pageResults[0]) openPage(pageResults[0]);
    if (mode === "outline" && outlineResults[0]) openOutline(outlineResults[0]);
    if (mode === "actions" && actionResults[0]) {
      window.location.assign(actionResults[0].href);
    }
  };

  if (!open) return null;

  return (
    <div className="command-backdrop" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <section
        aria-label="Command palette"
        aria-modal="true"
        className="command-palette"
        data-test-id="command-palette"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-search">
          <SearchIcon size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            data-test-id="command-palette-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={
              mode === "pages"
                ? "Jump to a page"
                : mode === "outline"
                  ? "Find a heading"
                  : "Run an action"
            }
          />
          <button
            type="button"
            aria-label="Close command palette"
            onClick={() => onOpenChange(false)}
          >
            <XIcon size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="command-tabs" role="tablist" aria-label="Palette mode">
          <button
            type="button"
            className={mode === "pages" ? "active" : ""}
            onClick={() => setMode("pages")}
          >
            <FileTextIcon size={14} aria-hidden="true" />
            Pages
          </button>
          <button
            type="button"
            className={mode === "outline" ? "active" : ""}
            onClick={() => {
              setOutline(collectOutline());
              setMode("outline");
            }}
          >
            <ListIcon size={14} aria-hidden="true" />
            Outline
          </button>
          <button
            type="button"
            className={mode === "actions" ? "active" : ""}
            onClick={() => setMode("actions")}
          >
            <SearchIcon size={14} aria-hidden="true" />
            Actions
          </button>
        </div>
        <div className="command-list">
          {mode === "pages" ? (
            pageResults.length === 0 ? (
              <div className="command-empty">No local pages found</div>
            ) : (
              pageResults.map((page) => (
                <button key={page.slug} type="button" onClick={() => openPage(page)}>
                  <FileTextIcon size={15} aria-hidden="true" />
                  <span>
                    <strong>{page.title}</strong>
                    <small>{page.slug}</small>
                  </span>
                </button>
              ))
            )
          ) : null}
          {mode === "outline" ? (
            outlineResults.length === 0 ? (
              <div className="command-empty">No headings on this page</div>
            ) : (
              outlineResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  style={
                    {
                      "--outline-depth": Math.max(0, item.level - 1),
                    } as CSSProperties
                  }
                  onClick={() => openOutline(item)}
                >
                  <ListIcon size={15} aria-hidden="true" />
                  <span>
                    <strong>{item.text}</strong>
                    <small>Heading {item.level}</small>
                  </span>
                </button>
              ))
            )
          ) : null}
          {mode === "actions" ? (
            actionResults.length === 0 ? (
              <div className="command-empty">No actions found</div>
            ) : (
              actionResults.map((action) => (
                <a key={action.label} href={action.href}>
                  {action.icon}
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>
                </a>
              ))
            )
          ) : null}
        </div>
        <footer className="command-footer">
          <span>{commandLabel()} opens pages</span>
          <span>Enter runs the first result</span>
        </footer>
      </section>
    </div>
  );
}
