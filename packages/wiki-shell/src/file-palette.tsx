import { useVirtualizer } from "@tanstack/react-virtual";
import fuzzysort from "fuzzysort";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  WikiCommandBackdrop,
  WikiCommandEmpty,
  WikiCommandFooter,
  WikiCommandList,
  WikiCommandPanel,
  WikiCommandSearch,
} from "./palette";
import { cn } from "./utils";

export type WikiFilePalettePage = {
  name: string;
  path: string;
  slug: string;
};

export type WikiFilePaletteRow =
  | { type: "heading"; label: string }
  | { type: "page"; page: WikiFilePalettePage; pageIndex: number };

export type WikiFilePaletteState = {
  recentEntries: WikiFilePalettePage[];
  searchResults: WikiFilePalettePage[] | null;
  visibleEntries: WikiFilePalettePage[];
  visibleRows: WikiFilePaletteRow[];
};

export const WIKI_FILE_PALETTE_RECENT_KEY = "cmd-palette-recent";
export const WIKI_FILE_PALETTE_MAX_RECENT = 8;
const MAX_SEARCH_RESULTS = 50;
const PALETTE_ROW_HEIGHT = 58;
const PALETTE_HEADING_HEIGHT = 32;

function displayName(page: WikiFilePalettePage) {
  return page.name.replace(/-/g, " ");
}

export function formatWikiFilePalettePath(slug: string) {
  const parts = slug.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export function buildWikiFilePaletteState(
  pages: WikiFilePalettePage[],
  query: string,
  recentSlugs: string[] = [],
): WikiFilePaletteState {
  const empty: WikiFilePaletteState = {
    recentEntries: [],
    searchResults: null,
    visibleEntries: [],
    visibleRows: [],
  };
  if (pages.length === 0) return empty;

  const normalizedQuery = query.trim().toLowerCase();
  const recentSet = new Set(recentSlugs.slice(0, WIKI_FILE_PALETTE_MAX_RECENT));
  const toPageRows = (entries: WikiFilePalettePage[]): WikiFilePaletteRow[] =>
    entries.map((page, pageIndex) => ({ type: "page", page, pageIndex }));

  if (normalizedQuery) {
    const prepared = pages.map((page) => ({
      page,
      prepName: fuzzysort.prepare(displayName(page)),
      prepPath: fuzzysort.prepare(page.path),
    }));
    const results = fuzzysort.go(query, prepared, {
      keys: ["prepName", "prepPath"],
      limit: MAX_SEARCH_RESULTS,
      threshold: -1000,
    });

    const ranked = results
      .map((result) => ({ page: result.obj.page, score: result.score }))
      .sort((left, right) => {
        const leftExact =
          left.page.slug.toLowerCase() === normalizedQuery ||
          displayName(left.page).toLowerCase() === normalizedQuery;
        const rightExact =
          right.page.slug.toLowerCase() === normalizedQuery ||
          displayName(right.page).toLowerCase() === normalizedQuery;
        if (leftExact !== rightExact) return leftExact ? -1 : 1;

        const scoreDiff = right.score - left.score;
        if (Math.abs(scoreDiff) < 50) {
          const leftRecent = recentSet.has(left.page.slug) ? 1 : 0;
          const rightRecent = recentSet.has(right.page.slug) ? 1 : 0;
          if (leftRecent !== rightRecent) return rightRecent - leftRecent;
        }

        return scoreDiff;
      })
      .map((result) => result.page);

    return {
      recentEntries: [],
      searchResults: ranked,
      visibleEntries: ranked,
      visibleRows: toPageRows(ranked),
    };
  }

  const recent = recentSlugs
    .slice(0, WIKI_FILE_PALETTE_MAX_RECENT)
    .map((slug) => pages.find((page) => page.slug === slug))
    .filter((page): page is WikiFilePalettePage => Boolean(page));
  const recentDisplaySet = new Set(recent.map((page) => page.slug));
  const remainingPages = pages.filter((page) => !recentDisplaySet.has(page.slug));
  const groupedEntries = [...recent, ...remainingPages];
  const rows: WikiFilePaletteRow[] = [];

  if (recent.length > 0) {
    rows.push({ type: "heading", label: "Recent pages" });
    rows.push(
      ...recent.map((page, pageIndex) => ({
        type: "page" as const,
        page,
        pageIndex,
      })),
    );
    if (remainingPages.length > 0) {
      rows.push({ type: "heading", label: "All pages" });
      rows.push(
        ...remainingPages.map((page, index) => ({
          type: "page" as const,
          page,
          pageIndex: recent.length + index,
        })),
      );
    }
  } else {
    rows.push(...toPageRows(pages));
  }

  return {
    recentEntries: recent,
    searchResults: null,
    visibleEntries: groupedEntries,
    visibleRows: rows,
  };
}

type WikiFilePaletteEntriesProps = {
  activeIndex: number;
  activeRowIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (page: WikiFilePalettePage) => void;
  pageIcon?: ReactNode;
  rows: WikiFilePaletteRow[];
  rowVirtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  valueMode: "label" | "slug";
};

function WikiFilePaletteEntries({
  activeIndex,
  activeRowIndex,
  onActiveIndexChange,
  onSelect,
  pageIcon,
  rows,
  rowVirtualizer,
  valueMode,
}: WikiFilePaletteEntriesProps) {
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div aria-label="Pages" role="group">
      <div
        className="wiki-shell-file-palette-virtual"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index];
          if (!row) return null;

          if (row.type === "heading") {
            return (
              <div
                className="wiki-shell-file-palette-heading"
                key={`${row.label}-${virtualItem.index}`}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {row.label}
              </div>
            );
          }

          const page = row.page;
          const selected = row.pageIndex === activeIndex;
          const value =
            valueMode === "slug"
              ? page.slug
              : `${page.name} ${page.path} ${formatWikiFilePalettePath(page.slug)}`;

          return (
            <button
              aria-selected={selected}
              className={cn(
                "wiki-shell-command-item wiki-shell-file-palette-item",
                selected && "active",
                virtualItem.index === activeRowIndex && "is-measured",
              )}
              data-active={selected ? "true" : undefined}
              data-index={row.pageIndex}
              data-value={value}
              id={`page-palette-${row.pageIndex}`}
              key={page.slug}
              onClick={() => onSelect(page)}
              onMouseEnter={() => onActiveIndexChange(row.pageIndex)}
              ref={rowVirtualizer.measureElement}
              role="option"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
              type="button"
            >
              {pageIcon ? (
                <span className="wiki-shell-file-palette-icon">{pageIcon}</span>
              ) : null}
              <span className="wiki-shell-command-item-text">
                <strong>{displayName(page)}</strong>
                <small>{formatWikiFilePalettePath(page.slug)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type WikiFilePaletteProps = {
  footer?: ReactNode;
  initialSearch?: string;
  loading?: boolean;
  loadingIcon?: ReactNode;
  onOpenChange: (open: boolean) => void;
  onSelectPage: (page: WikiFilePalettePage) => void;
  open: boolean;
  pageIcon?: ReactNode;
  pages: WikiFilePalettePage[];
  recentSlugs?: string[];
  searchIcon?: ReactNode;
  testId?: string;
};

export function WikiFilePalette({
  footer,
  initialSearch = "",
  loading = false,
  loadingIcon,
  onOpenChange,
  onSelectPage,
  open,
  pageIcon,
  pages,
  recentSlugs = [],
  searchIcon,
  testId = "command-palette",
}: WikiFilePaletteProps) {
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = search.trim();

  const { recentEntries, searchResults, visibleEntries, visibleRows } = useMemo(
    () => buildWikiFilePaletteState(pages, query, recentSlugs),
    [pages, query, recentSlugs],
  );

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: (index) =>
      visibleRows[index]?.type === "heading"
        ? PALETTE_HEADING_HEIGHT
        : PALETTE_ROW_HEIGHT,
    getScrollElement: () => listRef.current,
    overscan: 8,
  });

  const activeRowIndex = useMemo(
    () =>
      visibleRows.findIndex(
        (row) => row.type === "page" && row.pageIndex === activeIndex,
      ),
    [activeIndex, visibleRows],
  );

  useEffect(() => {
    if (!open) return;
    setSearch(initialSearch);
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [initialSearch, open]);

  const closePalette = useCallback(() => {
    onOpenChange(false);
    setSearch("");
    setActiveIndex(0);
  }, [onOpenChange]);

  const moveActive = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        if (visibleEntries.length === 0) return 0;
        const next = Math.min(
          Math.max(current + delta, 0),
          visibleEntries.length - 1,
        );
        const nextRowIndex = visibleRows.findIndex(
          (row) => row.type === "page" && row.pageIndex === next,
        );
        rowVirtualizer.scrollToIndex(nextRowIndex === -1 ? next : nextRowIndex, {
          align: "auto",
        });
        return next;
      });
    },
    [rowVirtualizer, visibleEntries.length, visibleRows],
  );

  const selectActive = useCallback(() => {
    const page = visibleEntries[activeIndex];
    if (page) onSelectPage(page);
  }, [activeIndex, onSelectPage, visibleEntries]);

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActive(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(-1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        const firstRowIndex = visibleRows.findIndex((row) => row.type === "page");
        rowVirtualizer.scrollToIndex(firstRowIndex === -1 ? 0 : firstRowIndex, {
          align: "start",
        });
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        const last = Math.max(0, visibleEntries.length - 1);
        setActiveIndex(last);
        const lastRowIndex = visibleRows.findIndex(
          (row) => row.type === "page" && row.pageIndex === last,
        );
        rowVirtualizer.scrollToIndex(lastRowIndex === -1 ? last : lastRowIndex, {
          align: "end",
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        selectActive();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
      }
    },
    [
      closePalette,
      moveActive,
      rowVirtualizer,
      selectActive,
      visibleEntries.length,
      visibleRows,
    ],
  );

  if (!open) return null;

  return (
    <WikiCommandBackdrop role="presentation" onMouseDown={() => closePalette()}>
      <WikiCommandPanel
        aria-label="Command palette"
        aria-modal="true"
        className="wiki-shell-file-palette"
        data-test-id={testId}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <WikiCommandSearch>
          {searchIcon}
          <input
            aria-activedescendant={
              visibleEntries[activeIndex] ? `page-palette-${activeIndex}` : undefined
            }
            aria-controls="page-palette-list"
            aria-expanded={open}
            aria-label="Search pages"
            autoComplete="off"
            data-test-id="command-palette-input"
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIndex(0);
              rowVirtualizer.scrollToIndex(0, { align: "start" });
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages..."
            ref={inputRef}
            role="combobox"
            value={search}
          />
        </WikiCommandSearch>
        <WikiCommandList
          aria-label="pages results"
          className="wiki-shell-file-palette-list"
          id="page-palette-list"
          ref={listRef}
          role="listbox"
        >
          {loading ? (
            <div className="wiki-shell-command-empty">
              {loadingIcon}
              <span>Loading pages...</span>
            </div>
          ) : visibleEntries.length === 0 ? (
            <WikiCommandEmpty>No pages found.</WikiCommandEmpty>
          ) : (
            <WikiFilePaletteEntries
              activeIndex={activeIndex}
              activeRowIndex={activeRowIndex}
              onActiveIndexChange={setActiveIndex}
              onSelect={onSelectPage}
              pageIcon={pageIcon}
              rows={visibleRows}
              rowVirtualizer={rowVirtualizer}
              valueMode={query ? "slug" : "label"}
            />
          )}
        </WikiCommandList>
        <WikiCommandFooter>
          {footer ?? (
            <>
              <span>Enter opens the first result</span>
              {recentEntries.length > 0 || searchResults ? (
                <span>{query ? "Fuzzy search" : "Recent pages first"}</span>
              ) : null}
            </>
          )}
        </WikiCommandFooter>
      </WikiCommandPanel>
    </WikiCommandBackdrop>
  );
}
