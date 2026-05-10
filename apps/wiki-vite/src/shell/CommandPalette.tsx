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
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  WikiCommandBackdrop,
  WikiCommandEmpty,
  WikiCommandFooter,
  WikiCommandItemButton,
  WikiCommandItemLink,
  WikiCommandList,
  WikiCommandPanel,
  WikiCommandSearch,
  WikiCommandTabs,
} from "@diana-tnbc/wiki-shell";
import { readLiveStoreDevtoolsEnabled, reloadWithLiveStoreDevtools } from "../livestore/devtools";
import { assets$, pageIndex$ } from "../livestore/queries";
import { events } from "../livestore/schema";
import { WARM_CACHE_EVENT } from "../sync/WikiSync";
import type { AssetIndexRow, PageIndexRow } from "../types";
import { useWikiScope } from "../wiki-context";
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
  const scope = useWikiScope();
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
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
    setActiveIndex(0);
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
        description: "Download the current scoped wiki as markdown",
        href: backendHref("/api/download", { type: "full", scope }),
        icon: <DownloadIcon size={15} aria-hidden="true" />,
      },
    ],
    [currentSlug, relatedAssets, returnTo, scope],
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

  const activeCount =
    mode === "pages"
      ? pageResults.length
      : mode === "outline"
        ? outlineResults.length
        : mode === "assets"
          ? assetResults.length
          : mode === "tags"
            ? tagResults.length
            : mode === "recent"
              ? recentResults.length
              : mode === "actions"
                ? actionResults.length
                : debugResults.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [mode, query]);

  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`command-${mode}-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, mode, open]);

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
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(Math.max(0, activeCount - 1), index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key !== "Enter") return;

    if (mode === "pages" && pageResults[activeIndex]) openPage(pageResults[activeIndex]);
    if (mode === "outline" && outlineResults[activeIndex]) openOutline(outlineResults[activeIndex]);
    if (mode === "assets" && assetResults[activeIndex]) {
      window.open(
        backendHref(`/api/file?path=${encodeURIComponent(assetResults[activeIndex].path)}`),
        "_blank",
        "noreferrer",
      );
    }
    if (mode === "tags" && tagResults[activeIndex]) {
      setQuery(tagResults[activeIndex].tag);
      setMode("pages");
    }
    if (mode === "recent" && recentResults[activeIndex]) openPage(recentResults[activeIndex]);
    if (mode === "actions" && actionResults[activeIndex]) {
      window.location.assign(actionResults[activeIndex].href);
    }
    if (mode === "debug" && debugResults[activeIndex]) {
      debugResults[activeIndex].run();
    }
  };

  if (!open) return null;

  return (
    <WikiCommandBackdrop role="presentation" onMouseDown={() => onOpenChange(false)}>
      <WikiCommandPanel
        aria-label="Command palette"
        aria-modal="true"
        data-test-id="command-palette"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <WikiCommandSearch>
          <SearchIcon size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            aria-activedescendant={activeCount > 0 ? `command-${mode}-${activeIndex}` : undefined}
            aria-controls={`command-${mode}-results`}
            aria-expanded="true"
            aria-labelledby="command-palette-title"
            data-test-id="command-palette-input"
            role="combobox"
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
        </WikiCommandSearch>
        <WikiCommandTabs role="group" aria-label="Palette mode">
          <button
            type="button"
            aria-pressed={mode === "pages"}
            className={mode === "pages" ? "active" : ""}
            onClick={() => setMode("pages")}
          >
            <FileTextIcon size={14} aria-hidden="true" />
            Pages
          </button>
          <button
            type="button"
            aria-pressed={mode === "outline"}
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
            aria-pressed={mode === "assets"}
            className={mode === "assets" ? "active" : ""}
            onClick={() => setMode("assets")}
          >
            <PaperclipIcon size={14} aria-hidden="true" />
            Assets
          </button>
          <button
            type="button"
            aria-pressed={mode === "tags"}
            className={mode === "tags" ? "active" : ""}
            onClick={() => setMode("tags")}
          >
            <TagIcon size={14} aria-hidden="true" />
            Tags
          </button>
          <button
            type="button"
            aria-pressed={mode === "recent"}
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
            aria-pressed={mode === "actions"}
            className={mode === "actions" ? "active" : ""}
            onClick={() => setMode("actions")}
          >
            <SearchIcon size={14} aria-hidden="true" />
            Actions
          </button>
          <button
            type="button"
            aria-pressed={mode === "debug"}
            className={mode === "debug" ? "active" : ""}
            onClick={() => setMode("debug")}
          >
            <BugIcon size={14} aria-hidden="true" />
            Debug
          </button>
        </WikiCommandTabs>
        <span id="command-palette-title" className="wiki-shell-sr-only">
          Command palette
        </span>
        <span aria-live="polite" className="wiki-shell-sr-only">
          {activeCount} {mode} result{activeCount === 1 ? "" : "s"}
        </span>
        <WikiCommandList
          aria-label={`${mode} results`}
          id={`command-${mode}-results`}
          role="listbox"
        >
          {mode === "pages" ? (
            pageResults.length === 0 ? (
              <WikiCommandEmpty>No local pages found</WikiCommandEmpty>
            ) : (
              pageResults.map((page, index) => (
                <WikiCommandItemButton
                  active={index === activeIndex}
                  description={page.slug}
                  id={`command-pages-${index}`}
                  icon={<FileTextIcon size={15} aria-hidden="true" />}
                  key={page.slug}
                  label={page.title}
                  onClick={() => openPage(page)}
                />
              ))
            )
          ) : null}
          {mode === "outline" ? (
            outlineResults.length === 0 ? (
              <WikiCommandEmpty>No headings on this page</WikiCommandEmpty>
            ) : (
              outlineResults.map((item, index) => (
                <WikiCommandItemButton
                  active={index === activeIndex}
                  depth={Math.max(0, item.level - 1)}
                  description={`Heading ${item.level}`}
                  id={`command-outline-${index}`}
                  icon={<ListIcon size={15} aria-hidden="true" />}
                  key={item.id}
                  label={item.text}
                  onClick={() => openOutline(item)}
                />
              ))
            )
          ) : null}
          {mode === "assets" ? (
            assetResults.length === 0 ? (
              <WikiCommandEmpty>No assets found</WikiCommandEmpty>
            ) : (
              assetResults.map((asset, index) => (
                <WikiCommandItemLink
                  active={index === activeIndex}
                  description={asset.path}
                  href={backendHref(`/api/file?path=${encodeURIComponent(asset.path)}`)}
                  id={`command-assets-${index}`}
                  icon={
                    asset.kind === "pdf" ? (
                      <FileTextIcon size={15} aria-hidden="true" />
                    ) : (
                      <FileIcon size={15} aria-hidden="true" />
                    )
                  }
                  key={asset.path}
                  label={asset.path.split("/").at(-1) ?? asset.path}
                  rel="noreferrer"
                  target="_blank"
                />
              ))
            )
          ) : null}
          {mode === "tags" ? (
            tagResults.length === 0 ? (
              <WikiCommandEmpty>No tags found</WikiCommandEmpty>
            ) : (
              tagResults.map((result, index) => (
                <WikiCommandItemButton
                  active={index === activeIndex}
                  description={`${result.count} pages`}
                  id={`command-tags-${index}`}
                  icon={<TagIcon size={15} aria-hidden="true" />}
                  key={result.tag}
                  label={result.tag}
                  onClick={() => {
                    setQuery(result.tag);
                    setMode("pages");
                  }}
                />
              ))
            )
          ) : null}
          {mode === "recent" ? (
            recentResults.length === 0 ? (
              <WikiCommandEmpty>No recent pages yet</WikiCommandEmpty>
            ) : (
              recentResults.map((page, index) => (
                <WikiCommandItemButton
                  active={index === activeIndex}
                  description={page.slug}
                  id={`command-recent-${index}`}
                  icon={<ClockIcon size={15} aria-hidden="true" />}
                  key={page.slug}
                  label={page.title}
                  onClick={() => openPage(page)}
                />
              ))
            )
          ) : null}
          {mode === "actions" ? (
            actionResults.length === 0 ? (
              <WikiCommandEmpty>No actions found</WikiCommandEmpty>
            ) : (
              actionResults.map((action, index) => (
                <WikiCommandItemLink
                  active={index === activeIndex}
                  description={action.description}
                  href={action.href}
                  id={`command-actions-${index}`}
                  icon={action.icon}
                  key={action.label}
                  label={action.label}
                />
              ))
            )
          ) : null}
          {mode === "debug" ? (
            debugResults.length === 0 ? (
              <WikiCommandEmpty>No cache tools found</WikiCommandEmpty>
            ) : (
              debugResults.map((action, index) => (
                <WikiCommandItemButton
                  active={index === activeIndex}
                  description={action.description}
                  id={`command-debug-${index}`}
                  icon={action.icon}
                  key={action.label}
                  label={action.label}
                  onClick={action.run}
                />
              ))
            )
          ) : null}
        </WikiCommandList>
        <WikiCommandFooter>
          <span>{commandLabel()} opens pages</span>
          <span>Enter runs the first result</span>
        </WikiCommandFooter>
      </WikiCommandPanel>
    </WikiCommandBackdrop>
  );
}
