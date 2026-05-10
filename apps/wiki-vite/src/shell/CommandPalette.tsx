import { useStore } from "@livestore/react";
import {
  BugIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ListIcon,
  MessageCircleIcon,
  PaperclipIcon,
  PowerIcon,
  PowerOffIcon,
  RotateCcwIcon,
  SearchIcon,
  ClockIcon,
  TagIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { readLiveStoreDevtoolsEnabled, reloadWithLiveStoreDevtools } from "../livestore/devtools";
import { assets$, pageIndex$ } from "../livestore/queries";
import { events } from "../livestore/schema";
import { WARM_CACHE_EVENT } from "../sync/WikiSync";
import type { AssetIndexRow, PageIndexRow } from "../types";
import {
  backendHref,
  hrefForSlug,
  parseJsonArray,
  readRecentSlugs,
  rememberSlug,
  returnToHref,
  slugFromPath,
} from "../wiki-utils";
import { assetFileName, assetHref, relatedAssetsForSlug } from "../wiki-assets";
import { collectOutline, scrollToOutlineItem, type OutlineItem } from "./outline";

export type PaletteMode = "pages" | "outline" | "assets" | "tags" | "recent" | "actions" | "debug";

type ActionItem = {
  label: string;
  description: string;
  href: string;
  icon: ReactNode;
};

type DebugItem = {
  label: string;
  description: string;
  icon: ReactNode;
  run: () => void;
};

type TagResult = {
  tag: string;
  count: number;
};

function commandLabel() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘K" : "Ctrl K";
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
  const { store } = useStore();
  const pages = store.useQuery(pageIndex$) as PageIndexRow[];
  const assets = store.useQuery(assets$) as AssetIndexRow[];
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState("");
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [recentSlugs, setRecentSlugs] = useState<string[]>([]);
  const [liveStoreDevtoolsEnabled] = useState(() => readLiveStoreDevtoolsEnabled());
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const currentSlug = slugFromPath(location.pathname);
  const returnTo = returnToHref(location.pathname, location.search, location.hash);

  useEffect(() => {
    if (!open) return;

    setMode(initialMode);
    setQuery("");
    setOutline(collectOutline());
    setRecentSlugs(readRecentSlugs());
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

  const relatedAssets = useMemo(
    () => relatedAssetsForSlug(currentSlug, assets).slice(0, 3),
    [assets, currentSlug],
  );

  const actions = useMemo<ActionItem[]>(
    () => [
      ...relatedAssets.map((asset) => ({
        label: `Open ${assetFileName(asset.path)}`,
        description: `Source file for ${currentSlug}`,
        href: assetHref(asset.path),
        icon:
          asset.kind === "pdf" ? (
            <FileTextIcon size={15} aria-hidden="true" />
          ) : (
            <FileIcon size={15} aria-hidden="true" />
          ),
      })),
      {
        label: "Search wiki",
        description: "Open the backend full-text and AI search surface",
        href: backendHref("/search", { returnTo }),
        icon: <SearchIcon size={15} aria-hidden="true" />,
      },
      {
        label: "New chat",
        description: "Continue in the full-stack chat experience",
        href: backendHref("/chat", { returnTo }),
        icon: <MessageCircleIcon size={15} aria-hidden="true" />,
      },
      {
        label: "Download full wiki",
        description: "Use the existing backend download pipeline",
        href: backendHref("/api/download?type=full"),
        icon: <DownloadIcon size={15} aria-hidden="true" />,
      },
    ],
    [currentSlug, relatedAssets, returnTo],
  );

  const actionResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.description}`.toLowerCase().includes(normalized),
    );
  }, [actions, query]);

  const debugActions = useMemo<DebugItem[]>(
    () => [
      {
        label: "Warm local markdown cache",
        description: "Queue eager markdown fetches for local reading",
        icon: <ZapIcon size={15} aria-hidden="true" />,
        run: () => {
          window.dispatchEvent(new Event(WARM_CACHE_EVENT));
          onOpenChange(false);
        },
      },
      {
        label: "Reset local cache",
        description: "Clear this LiveStore cache and reload the reader",
        icon: <RotateCcwIcon size={15} aria-hidden="true" />,
        run: () => {
          const confirmed = window.confirm(
            "Clear the local LiveStore cache for this reader and reload?",
          );
          if (!confirmed) return;
          store.commit(events.cacheResetRequested({ requestedAt: Date.now() }));
          window.location.reload();
        },
      },
      {
        label: liveStoreDevtoolsEnabled ? "Disable LiveStore devtools" : "Enable LiveStore devtools",
        description: "Reload with the optional local LiveStore inspector setting",
        icon: liveStoreDevtoolsEnabled ? (
          <PowerOffIcon size={15} aria-hidden="true" />
        ) : (
          <PowerIcon size={15} aria-hidden="true" />
        ),
        run: () => reloadWithLiveStoreDevtools(!liveStoreDevtoolsEnabled),
      },
    ],
    [liveStoreDevtoolsEnabled, onOpenChange, store],
  );

  const debugResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return debugActions;
    return debugActions.filter((action) =>
      `${action.label} ${action.description}`.toLowerCase().includes(normalized),
    );
  }, [debugActions, query]);

  const assetResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? assets.filter((asset) => asset.path.toLowerCase().includes(normalized))
      : assets;
    return matches.slice(0, 14);
  }, [assets, query]);

  const tagResults = useMemo<TagResult[]>(() => {
    const counts = new Map<string, number>();
    for (const page of pages) {
      for (const tag of parseJsonArray<string>(page.tagsJson)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    const normalized = query.trim().toLowerCase();
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .filter((result) => !normalized || result.tag.toLowerCase().includes(normalized))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
      .slice(0, 14);
  }, [pages, query]);

  const recentResults = useMemo(() => {
    const pagesBySlug = new Map(pages.map((page) => [page.slug, page]));
    const normalized = query.trim().toLowerCase();
    return recentSlugs
      .map((slug) => pagesBySlug.get(slug))
      .filter((page): page is PageIndexRow => Boolean(page))
      .filter(
        (page) =>
          !normalized ||
          `${page.title} ${page.slug} ${page.tagsJson}`.toLowerCase().includes(normalized),
      )
      .slice(0, 12);
  }, [pages, query, recentSlugs]);

  const openPage = (page: PageIndexRow) => {
    rememberSlug(page.slug);
    navigate(hrefForSlug(page.slug));
    onOpenChange(false);
  };

  const openOutline = (item: OutlineItem) => {
    scrollToOutlineItem(item, location.pathname);
    onOpenChange(false);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;

    if (mode === "pages" && pageResults[0]) openPage(pageResults[0]);
    if (mode === "outline" && outlineResults[0]) openOutline(outlineResults[0]);
    if (mode === "assets" && assetResults[0]) {
      window.open(
        backendHref(`/api/file?path=${encodeURIComponent(assetResults[0].path)}`),
        "_blank",
        "noreferrer",
      );
    }
    if (mode === "tags" && tagResults[0]) {
      setQuery(tagResults[0].tag);
      setMode("pages");
    }
    if (mode === "recent" && recentResults[0]) openPage(recentResults[0]);
    if (mode === "actions" && actionResults[0]) {
      window.location.assign(actionResults[0].href);
    }
    if (mode === "debug" && debugResults[0]) {
      debugResults[0].run();
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
                  : mode === "assets"
                    ? "Find a source or file"
                    : mode === "tags"
                      ? "Filter local tags"
                      : mode === "recent"
                        ? "Find recent pages"
                        : mode === "actions"
                          ? "Run an action"
                          : "Run a cache tool"
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
            className={mode === "assets" ? "active" : ""}
            onClick={() => setMode("assets")}
          >
            <PaperclipIcon size={14} aria-hidden="true" />
            Assets
          </button>
          <button
            type="button"
            className={mode === "tags" ? "active" : ""}
            onClick={() => setMode("tags")}
          >
            <TagIcon size={14} aria-hidden="true" />
            Tags
          </button>
          <button
            type="button"
            className={mode === "recent" ? "active" : ""}
            onClick={() => {
              setRecentSlugs(readRecentSlugs());
              setMode("recent");
            }}
          >
            <ClockIcon size={14} aria-hidden="true" />
            Recent
          </button>
          <button
            type="button"
            className={mode === "actions" ? "active" : ""}
            onClick={() => setMode("actions")}
          >
            <SearchIcon size={14} aria-hidden="true" />
            Actions
          </button>
          <button
            type="button"
            className={mode === "debug" ? "active" : ""}
            onClick={() => setMode("debug")}
          >
            <BugIcon size={14} aria-hidden="true" />
            Debug
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
          {mode === "assets" ? (
            assetResults.length === 0 ? (
              <div className="command-empty">No assets found</div>
            ) : (
              assetResults.map((asset) => (
                <a
                  key={asset.path}
                  href={backendHref(`/api/file?path=${encodeURIComponent(asset.path)}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {asset.kind === "pdf" ? (
                    <FileTextIcon size={15} aria-hidden="true" />
                  ) : (
                    <FileIcon size={15} aria-hidden="true" />
                  )}
                  <span>
                    <strong>{asset.path.split("/").at(-1) ?? asset.path}</strong>
                    <small>{asset.path}</small>
                  </span>
                </a>
              ))
            )
          ) : null}
          {mode === "tags" ? (
            tagResults.length === 0 ? (
              <div className="command-empty">No tags found</div>
            ) : (
              tagResults.map((result) => (
                <button
                  key={result.tag}
                  type="button"
                  onClick={() => {
                    setQuery(result.tag);
                    setMode("pages");
                  }}
                >
                  <TagIcon size={15} aria-hidden="true" />
                  <span>
                    <strong>{result.tag}</strong>
                    <small>{result.count} pages</small>
                  </span>
                </button>
              ))
            )
          ) : null}
          {mode === "recent" ? (
            recentResults.length === 0 ? (
              <div className="command-empty">No recent pages yet</div>
            ) : (
              recentResults.map((page) => (
                <button key={page.slug} type="button" onClick={() => openPage(page)}>
                  <ClockIcon size={15} aria-hidden="true" />
                  <span>
                    <strong>{page.title}</strong>
                    <small>{page.slug}</small>
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
          {mode === "debug" ? (
            debugResults.length === 0 ? (
              <div className="command-empty">No cache tools found</div>
            ) : (
              debugResults.map((action) => (
                <button key={action.label} type="button" onClick={action.run}>
                  {action.icon}
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>
                </button>
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
