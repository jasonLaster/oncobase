import { useVirtualizer } from "@tanstack/react-virtual";
import { buildCommandPaletteRows, prepareCommandPalettePages } from "./command-palette-pages.ts";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
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
} from "./palette.tsx";
import { cn } from "./utils.ts";

export type WikiFilePalettePage = {
  name: string;
  title?: string;
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
const EMPTY_RECENT_SLUGS: string[] = [];
const PALETTE_ROW_HEIGHT = 56;
const PALETTE_HEADING_HEIGHT = 28;
const preparedIndexes = new WeakMap<WikiFilePalettePage[], ReturnType<typeof preparePages>>();

const preparePages = prepareCommandPalettePages;

function preparedPages(pages: WikiFilePalettePage[]) {
  let prepared = preparedIndexes.get(pages);
  if (!prepared) {
    prepared = preparePages(pages);
    preparedIndexes.set(pages, prepared);
  }
  return prepared;
}

function displayName(page: WikiFilePalettePage) {
  return page.name.replace(/-/g, " ");
}

/** Counts palette opens across mounts: hosts unmount the palette when it
 * closes, so a per-instance ref would restart and a stale focus restore from
 * the previous instance could not tell it was superseded. */
let paletteOpenGeneration = 0;

export function formatWikiFilePalettePath(slug: string) {
  const parts = slug.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "/";
}

export function buildWikiFilePaletteState(
  pages: WikiFilePalettePage[],
  query: string,
  recentSlugs: string[] = [],
  recommendedSlugs: string[] = [],
): WikiFilePaletteState {
  return buildCommandPaletteRows({
    pages,
    prepared: query.trim() ? preparedPages(pages) : [],
    query,
    recentSlugs: recentSlugs.slice(0, WIKI_FILE_PALETTE_MAX_RECENT),
    recommendedSlugs,
  });
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
              data-index={virtualItem.index}
              data-page-index={row.pageIndex}
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
  /** Recommends pages for a query (slugs, best first), shown above the fuzzy
   * matches once it resolves. Called after typing pauses; aborted when the
   * query changes or the palette closes. */
  recommend?: (query: string, signal: AbortSignal) => Promise<string[]>;
  searchIcon?: ReactNode;
  testId?: string;
};

const EMPTY_RECOMMENDED: string[] = [];
const RECOMMEND_DEBOUNCE_MS = 250;

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
  recentSlugs = EMPTY_RECENT_SLUGS,
  recommend,
  searchIcon,
  testId = "command-palette",
}: WikiFilePaletteProps) {
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const didResetScrollForOpenRef = useRef(false);
  const query = search.trim();
  const onOpenChangeRef = useRef(onOpenChange);
  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const closePalette = useCallback(() => {
    onOpenChangeRef.current(false);
    setSearch("");
    setActiveIndex(0);
  }, []);

  // Recommendations belong to the query they were asked for, so a stale
  // answer never shows under a newer query.
  const [recommendation, setRecommendation] = useState<{ query: string; slugs: string[]; pending: boolean } | null>(null);
  useEffect(() => {
    if (!open || !recommend || query.length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setRecommendation({ query, slugs: EMPTY_RECOMMENDED, pending: true });
      recommend(query, controller.signal).then(
        (slugs) => { if (!controller.signal.aborted) setRecommendation({ query, slugs, pending: false }); },
        () => { if (!controller.signal.aborted) setRecommendation({ query, slugs: EMPTY_RECOMMENDED, pending: false }); },
      );
    }, RECOMMEND_DEBOUNCE_MS);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [open, query, recommend]);
  const recommendedSlugs = recommendation?.query === query ? recommendation.slugs : EMPTY_RECOMMENDED;
  const recommending = recommendation?.query === query && recommendation.pending;

  const { recentEntries, searchResults, visibleEntries, visibleRows } = useMemo(
    () => buildWikiFilePaletteState(pages, query, recentSlugs, recommendedSlugs),
    [pages, query, recentSlugs, recommendedSlugs],
  );

  // Recommendations arrive after the matches: keep the page the reader has
  // moved to selected, or select the top recommendation if they have not.
  const activeSlugRef = useRef<string | null>(null);
  const appliedRecommendationRef = useRef(recommendedSlugs);
  useLayoutEffect(() => {
    if (appliedRecommendationRef.current === recommendedSlugs) {
      activeSlugRef.current = visibleEntries[activeIndex]?.slug ?? null;
      return;
    }
    appliedRecommendationRef.current = recommendedSlugs;
    const previous = activeSlugRef.current;
    const kept = activeIndex > 0 && previous ? visibleEntries.findIndex((page) => page.slug === previous) : -1;
    setActiveIndex(kept === -1 ? 0 : kept);
  }, [activeIndex, recommendedSlugs, visibleEntries]);

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: (index) =>
      visibleRows[index]?.type === "heading"
        ? PALETTE_HEADING_HEIGHT
        : PALETTE_ROW_HEIGHT,
    getScrollElement: () => listElement,
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
    const generation = ++paletteOpenGeneration;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setSearch(initialSearch);
    setActiveIndex(0);
    const focusTimeout = window.setTimeout(() => inputRef.current?.focus(), 0);

    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePalette();
        return;
      }

      if (event.key !== "Tab") return;
      const panel = inputRef.current?.closest<HTMLElement>('[role="dialog"]');
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("inert"));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onDocumentKeyDown, { capture: true });
    return () => {
      window.clearTimeout(focusTimeout);
      document.removeEventListener("keydown", onDocumentKeyDown, { capture: true });
      document.body.style.overflow = previousOverflow;
      // Let the closing mouse event finish before restoring focus, otherwise
      // its default action can blur the trigger again after cleanup. Skip the
      // restore if the palette opened again meanwhile (Escape then Cmd+K):
      // a late restore would pull focus out of the reopened input.
      const previouslyFocused = previouslyFocusedRef.current;
      window.setTimeout(() => {
        if (paletteOpenGeneration === generation) previouslyFocused?.focus();
      }, 0);
      previouslyFocusedRef.current = null;
    };
  }, [closePalette, initialSearch, open]);

  useEffect(() => {
    if (!open || !listElement || visibleRows.length === 0) return;
    rowVirtualizer.measure();
  }, [listElement, open, rowVirtualizer, visibleRows.length]);

  useEffect(() => {
    if (!open) {
      didResetScrollForOpenRef.current = false;
      return;
    }

    if (!listElement || visibleRows.length === 0 || didResetScrollForOpenRef.current) return;

    didResetScrollForOpenRef.current = true;
    listElement.scrollTo({ top: 0 });
    rowVirtualizer.scrollToIndex(0, { align: "start" });
  }, [listElement, open, rowVirtualizer, visibleRows.length]);

  const moveActive = useCallback(
    (delta: number) => {
      if (visibleEntries.length === 0) {
        setActiveIndex(0);
        return;
      }
      const next = Math.min(Math.max(activeIndex + delta, 0), visibleEntries.length - 1);
      setActiveIndex(next);
      const nextRowIndex = visibleRows.findIndex(
        (row) => row.type === "page" && row.pageIndex === next,
      );
      rowVirtualizer.scrollToIndex(nextRowIndex === -1 ? next : nextRowIndex, {
        align: "auto",
      });
    },
    [activeIndex, rowVirtualizer, visibleEntries.length, visibleRows],
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
        aria-label="Go to page"
        aria-modal="true"
        className="wiki-shell-file-palette"
        data-recommend={recommend && query.length >= 2 ? (recommending ? "pending" : recommendation?.query === query ? "done" : "waiting") : undefined}
        data-test-id={testId}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <WikiCommandSearch>
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
            placeholder="Search pages…"
            ref={inputRef}
            role="combobox"
            value={search}
          />
          {searchIcon}
        </WikiCommandSearch>
        <WikiCommandList
          aria-label="pages results"
          className="wiki-shell-file-palette-list"
          id="page-palette-list"
          ref={setListElement}
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
        {footer === false ? null : (
          <WikiCommandFooter>
            {footer ?? (
              <>
                <span>Enter opens the first result</span>
                {recentEntries.length > 0 || searchResults ? (
                  <span>{query ? (recommending ? "Asking Jev…" : recommendedSlugs.length ? "Recommended by Jev" : "Fuzzy search") : "Recent pages first"}</span>
                ) : null}
              </>
            )}
          </WikiCommandFooter>
        )}
      </WikiCommandPanel>
    </WikiCommandBackdrop>
  );
}
