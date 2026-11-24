import { Command, CommandGroup, CommandInput, CommandItem } from "@oncobase/ui/command";
import { Dialog } from "@oncobase/ui/dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildCommandPaletteRows, prepareCommandPalettePages } from "./command-palette-pages.ts";
export { PALETTE_SHORTHAND } from "./command-palette-pages.ts";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  WikiCommandBackdrop,
  WikiCommandEmpty,
  WikiCommandFooter,
  WikiCommandGroupHeading,
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

export type WikiFilePaletteProps = {
  footer?: ReactNode;
  initialSearch?: string;
  loading?: boolean;
  loadingIcon?: ReactNode;
  onOpenChange: (open: boolean) => void;
  onSelectPage: (page: WikiFilePalettePage) => void;
  /** Told which page was opened for a typed query, where it was listed and
   * what was recommended, so the host can learn what readers look for. */
  onPick?: (pick: WikiFilePalettePick) => void;
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

export type WikiFilePalettePick = {
  query: string;
  slug: string;
  /** 1-based place in the list as shown (Recommended first). */
  position: number;
  recommended: boolean;
  recommendedSlugs: string[];
};

const EMPTY_RECOMMENDED: string[] = [];
/** Asks again once typing pauses; each keystroke cancels the pending ask. */
const RECOMMEND_DEBOUNCE_MS = 250;


type RowVirtualizer = ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;

type WikiFilePaletteEntriesProps = {
  pageIcon?: ReactNode;
  rows: WikiFilePaletteRow[];
  rowVirtualizer: RowVirtualizer;
  valueMode: "label" | "slug";
};

function WikiFilePaletteEntries({ pageIcon, rows, rowVirtualizer, valueMode }: WikiFilePaletteEntriesProps) {
  const virtualItems = rowVirtualizer.getVirtualItems();
  // Rows render windowed, so each heading's group holds only its mounted rows;
  // its label stays at the heading's own offset even when that row is scrolled out.
  const sections: Array<{ heading: number; items: typeof virtualItems }> = [];
  for (const virtualItem of virtualItems) {
    const row = rows[virtualItem.index];
    if (!row || row.type !== "page") continue;
    let heading = virtualItem.index - 1;
    while (heading >= 0 && rows[heading]?.type !== "heading") heading--;
    const last = sections.at(-1);
    if (last && last.heading === heading) last.items.push(virtualItem);
    else sections.push({ heading, items: [virtualItem] });
  }

  const renderItem = (virtualItem: (typeof virtualItems)[number]) => {
    const row = rows[virtualItem.index];
    if (row?.type !== "page") return null;
    const page = row.page;
    return (
      <CommandItem
        className={(state) =>
          cn("wiki-shell-command-item wiki-shell-file-palette-item", state.highlighted && "active")
        }
        data-index={virtualItem.index}
        data-value={
          valueMode === "slug"
            ? page.slug
            : `${page.name} ${page.path} ${formatWikiFilePalettePath(page.slug)}`
        }
        index={row.pageIndex}
        key={page.slug}
        label={displayName(page)}
        ref={rowVirtualizer.measureElement}
        style={{ transform: `translateY(${virtualItem.start}px)` }}
        value={page.slug}
      >
        {pageIcon ? <span className="wiki-shell-file-palette-icon">{pageIcon}</span> : null}
        <span className="wiki-shell-command-item-text">
          <strong>{displayName(page)}</strong>
          <small>{formatWikiFilePalettePath(page.slug)}</small>
        </span>
      </CommandItem>
    );
  };

  return (
    <div
      className="wiki-shell-file-palette-virtual"
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
    >
      {sections.map((section) => {
        const heading = rows[section.heading];
        if (heading?.type !== "heading") return section.items.map(renderItem);
        const start = rowVirtualizer.measurementsCache[section.heading]?.start ?? 0;
        return (
          <CommandGroup key={heading.label}>
            <WikiCommandGroupHeading
              className={() => "wiki-shell-file-palette-heading"}
              style={{ transform: `translateY(${start}px)` }}
            >
              {heading.label}
            </WikiCommandGroupHeading>
            {section.items.map(renderItem)}
          </CommandGroup>
        );
      })}
    </div>
  );
}

export function WikiFilePalette(props: WikiFilePaletteProps) {
  // Each open starts a fresh search, scroll position and highlight.
  return props.open ? <WikiFilePaletteDialog key={props.initialSearch ?? ""} {...props} /> : null;
}

function WikiFilePaletteDialog({
  footer,
  initialSearch = "",
  loading = false,
  loadingIcon,
  onOpenChange,
  onSelectPage,
  onPick,
  pageIcon,
  pages,
  recentSlugs = EMPTY_RECENT_SLUGS,
  recommend,
  searchIcon,
  testId = "command-palette",
}: WikiFilePaletteProps) {
  const [search, setSearch] = useState(initialSearch);
  const [activeIndex, setActiveIndex] = useState(0);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const query = search.trim();

  // The last answer stays on screen while the next one is asked for, so the
  // group never blinks out as you type; a spinner in the search box shows
  // that a newer answer is coming.
  const [recommendation, setRecommendation] = useState<{ query: string; slugs: string[] } | null>(null);
  useEffect(() => {
    if (!recommend || query.length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      recommend(query, controller.signal).then(
        (slugs) => { if (!controller.signal.aborted) setRecommendation({ query, slugs }); },
        () => { if (!controller.signal.aborted) setRecommendation({ query, slugs: EMPTY_RECOMMENDED }); },
      );
    }, RECOMMEND_DEBOUNCE_MS);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [query, recommend]);
  const asking = Boolean(recommend) && query.length >= 2;
  const recommendedSlugs = asking && recommendation ? recommendation.slugs : EMPTY_RECOMMENDED;
  // From the first keystroke until the answer for this query arrives.
  const recommending = asking && recommendation?.query !== query;

  // Typing never waits on ranking: on a slow device the list catches up
  // with the input instead of each keystroke blocking on a full re-rank.
  const rankedQuery = useDeferredValue(query);
  const { recentEntries, searchResults, visibleEntries, visibleRows } = useMemo(
    () => buildWikiFilePaletteState(pages, rankedQuery, recentSlugs, recommendedSlugs),
    [pages, rankedQuery, recentSlugs, recommendedSlugs],
  );
  const commandItems = useMemo(
    () => (loading ? [] : visibleEntries.map((page) => ({ value: page.slug, label: displayName(page) }))),
    [loading, visibleEntries],
  );

  // Recommendations arrive after the matches: keep the page the reader has
  // moved to highlighted, or highlight the top recommendation if they have not.
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
    count: loading ? 0 : visibleRows.length,
    estimateSize: (index) =>
      visibleRows[index]?.type === "heading"
        ? PALETTE_HEADING_HEIGHT
        : PALETTE_ROW_HEIGHT,
    getScrollElement: () => listElement,
    overscan: 8,
  });

  useEffect(() => {
    if (!listElement || visibleRows.length === 0) return;
    rowVirtualizer.measure();
  }, [listElement, rowVirtualizer, visibleRows.length]);

  const rowOfPage = useCallback(
    (pageIndex: number) => visibleRows.findIndex((row) => row.type === "page" && row.pageIndex === pageIndex),
    [visibleRows],
  );

  const selectPage = useCallback((page: WikiFilePalettePage) => {
    // Only what was ranked for what is typed: a pick made before the deferred
    // ranking caught up would record a list the reader never saw.
    if (onPick && query && rankedQuery === query) {
      const first = visibleRows[0];
      const matchesAt = visibleRows.findIndex((row) => row.type === "heading" && row.label === "Matches");
      const rowAt = visibleRows.findIndex((row) => row.type === "page" && row.page === page);
      onPick({
        query, slug: page.slug, position: visibleEntries.indexOf(page) + 1,
        recommended: first?.type === "heading" && first.label === "Recommended" && (matchesAt === -1 || rowAt < matchesAt),
        recommendedSlugs,
      });
    }
    onSelectPage(page);
  }, [onPick, onSelectPage, query, rankedQuery, recommendedSlugs, visibleEntries, visibleRows]);

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <WikiCommandBackdrop />
      <WikiCommandPanel
        className="wiki-shell-file-palette"
        data-recommend={recommend && query.length >= 2 ? (recommending ? "pending" : "done") : undefined}
        data-test-id={testId}
        title="Go to page"
      >
        <Command
          filter={false}
          items={commandItems}
          onAction={(slug) => {
            const page = visibleEntries.find((entry) => entry.slug === slug);
            if (page) selectPage(page);
          }}
          onQueryChange={(next) => {
            setSearch(next);
            // Clearing the query starts recommendations over.
            if (next.trim().length < 2) setRecommendation(null);
            setActiveIndex(0);
            rowVirtualizer.scrollToIndex(0, { align: "start" });
          }}
          onValueChange={(slug, details) => {
            const index = details.index >= 0 ? details.index : visibleEntries.findIndex((page) => page.slug === slug);
            if (index < 0) return;
            setActiveIndex(index);
            if (details.reason !== "item-hover") rowVirtualizer.scrollToIndex(rowOfPage(index), { align: "auto" });
          }}
          query={search}
          status={loading ? "loading" : "idle"}
          value={visibleEntries[activeIndex]?.slug ?? null}
        >
          <WikiCommandSearch>
            <CommandInput
              aria-label="Search pages"
              autoComplete="off"
              data-test-id="command-palette-input"
              placeholder="Search pages…"
            />
            {recommending ? (
              <span aria-label="Finding recommended pages" className="wiki-shell-file-palette-spinner" role="status" />
            ) : searchIcon}
          </WikiCommandSearch>
          <WikiCommandEmpty>
            {(state) =>
              state.loading ? (
                <>
                  {loadingIcon}
                  <span>Loading pages...</span>
                </>
              ) : state.empty ? (
                "No pages found."
              ) : null
            }
          </WikiCommandEmpty>
          <WikiCommandList
            className="wiki-shell-file-palette-list"
            id="page-palette-list"
            ref={setListElement}
          >
            {() => (
              <WikiFilePaletteEntries
                pageIcon={pageIcon}
                rows={visibleRows}
                rowVirtualizer={rowVirtualizer}
                valueMode={query ? "slug" : "label"}
              />
            )}
          </WikiCommandList>
        </Command>
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
    </Dialog>
  );
}
