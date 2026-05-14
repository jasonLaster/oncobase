"use client";

import { useEffect, useState, useCallback, useRef, useMemo, useSyncExternalStore, useTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePathname, useRouter } from "next/navigation";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileTextIcon, Loader2Icon, HeadingIcon, ListTreeIcon, CalculatorIcon } from "lucide-react";
import fuzzysort from "fuzzysort";
import { themeEffect } from "@/lib/theme-effect";
import { cn } from "@/lib/utils";
import { setNavigationIntent } from "@/lib/navigation-intent";

interface PageEntry {
  name: string;
  slug: string;
  path: string;
}

type PaletteRow =
  | { type: "heading"; label: string }
  | { type: "page"; page: PageEntry; pageIndex: number };

type OutlineHeading = {
  key: string;
  id: string | null;
  index: number;
  level: number;
  text: string;
};

// ─── Theme store ──────────────────────────────────────────────────────────────

let themeListeners: Array<() => void> = [];
function subscribeTheme(cb: () => void) {
  themeListeners.push(cb);
  return () => { themeListeners = themeListeners.filter((l) => l !== cb); };
}
function notifyTheme() { themeListeners.forEach((l) => l()); }
function getThemePref() { return localStorage.getItem("theme"); }
function getThemePrefServer() { return null; }

// ─── Icons ────────────────────────────────────────────────────────────────────

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 56 56" fill="currentColor" className="shrink-0">
    <path d="M30 4.6c0-1-.9-2-2-2a2 2 0 00-2 2v5c0 1 .9 2 2 2s2-1 2-2zm9.6 9a2 2 0 000 2.8c.8.8 2 .8 2.9 0L46 13a2 2 0 000-2.9 2 2 0 00-3 0zm-26 2.8c.7.8 2 .8 2.8 0 .8-.7.8-2 0-2.9L13 10c-.7-.7-2-.8-2.9 0-.7.8-.7 2.1 0 3zM28 16a12 12 0 00-12 12 12 12 0 0012 12 12 12 0 0012-12 12 12 0 00-12-12zm0 3.6c4.6 0 8.4 3.8 8.4 8.4 0 4.6-3.8 8.4-8.4 8.4a8.5 8.5 0 01-8.4-8.4c0-4.6 3.8-8.4 8.4-8.4zM51.3 30c1.1 0 2-.9 2-2s-.9-2-2-2h-4.9a2 2 0 00-2 2c0 1.1 1 2 2 2zM4.7 26a2 2 0 00-2 2c0 1.1.9 2 2 2h4.9c1 0 2-.9 2-2s-1-2-2-2zm37.8 13.6a2 2 0 00-3 0 2 2 0 000 2.9l3.6 3.5a2 2 0 002.9 0c.8-.8.8-2.1 0-3zM10 43.1a2 2 0 000 2.9c.8.7 2.1.8 3 0l3.4-3.5c.8-.8.8-2.1 0-2.9-.8-.8-2-.8-2.9 0zm20 3.4c0-1.1-.9-2-2-2a2 2 0 00-2 2v4.9c0 1 .9 2 2 2s2-1 2-2z" />
  </svg>
);
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 56 56" fill="currentColor" className="shrink-0">
    <path d="M41.2 36.1c-12.9 0-21-7.8-21-20.3 0-3.5.7-6.7 1.6-8.3.3-.7.4-1 .4-1.5 0-.8-.7-1.7-1.7-1.7-.2 0-.7 0-1.3.3A24.5 24.5 0 004.4 27.1 23.8 23.8 0 0029 51.7c10.2 0 18.4-5.3 22.3-14.1l.3-1.4c0-1-.9-1.6-1.6-1.6a3 3 0 00-1.2.2c-2 .8-4.8 1.3-7.6 1.3zM8.1 27c0-7.3 3.8-14.3 9.9-18-.8 2-1.2 4.5-1.2 7.2 0 14.6 9 23.3 23.9 23.3 2.4 0 4.5-.2 6.4-1a20.8 20.8 0 01-18 9.6C17 48 8.1 39 8.1 27z" />
  </svg>
);
const MonitorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <rect x="1" y="2" width="14" height="10" rx="1.5" />
    <path d="M5 14h6M8 12v2" />
  </svg>
);
const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <path d="M8 2v9m0 0L5 8m3 3l3-3" />
    <path d="M2 12v1.5a.5.5 0 00.5.5h11a.5.5 0 00.5-.5V12" />
  </svg>
);
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <circle cx="6.5" cy="6.5" r="4" />
    <path d="M11 11l3 3" />
  </svg>
);

// ─── Recent files (localStorage) ─────────────────────────────────────────────

const RECENT_KEY = "cmd-palette-recent";
const MAX_RECENT = 8;
const MAX_SEARCH_RESULTS = 50;
const PALETTE_ROW_HEIGHT = 56;
const PALETTE_HEADING_HEIGHT = 28;

function getRecentSlugs(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentSlug(slug: string) {
  const recent = getRecentSlugs().filter((s) => s !== slug);
  recent.unshift(slug);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch { /* quota exceeded — ignore */ }
}

// ─── Palette globals + chord state ───────────────────────────────────────────

let globalOpenFiles: (() => void) | null = null;
let globalOpenOutline: (() => void) | null = null;
let globalOpenAction: (() => void) | null = null;

export function openCommandPalette() {
  globalOpenFiles?.();
}
export function openActionPalette() {
  globalOpenAction?.();
}

const CHORD_WINDOW_MS = 600;
let chordTimer: ReturnType<typeof setTimeout> | null = null;

function startChord() {
  if (chordTimer) clearTimeout(chordTimer);
  chordTimer = setTimeout(() => {
    chordTimer = null;
    globalOpenFiles?.();
  }, CHORD_WINDOW_MS);
}

function endChord() {
  if (chordTimer) clearTimeout(chordTimer);
  chordTimer = null;
}

// ─── File palette (Cmd+K) ─────────────────────────────────────────────────────

type IdleSchedulerWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const query = search.trim();
  const [isNavigating, startNavigation] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const pagesLoadedRef = useRef(false);
  const pagesRequestRef = useRef<Promise<void> | null>(null);
  const didResetScrollForOpenRef = useRef(false);

  const loadPages = useCallback((showLoading = false) => {
    if (pagesLoadedRef.current) return;

    if (showLoading) {
      setLoading(true);
    }

    if (pagesRequestRef.current) {
      // The in-flight request owns clearing the loading spinner in finally.
      return;
    }

    pagesRequestRef.current = fetch("/api/pages")
      .then((r) => {
        if (!r.ok) throw new Error(`pages request failed: ${r.status}`);
        return r.json();
      })
      .then((nextPages: PageEntry[]) => {
        pagesLoadedRef.current = true;
        setPages(nextPages);
      })
      .catch(() => {})
      .finally(() => {
        pagesRequestRef.current = null;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    globalOpenFiles = () => setOpen(true);
    return () => { globalOpenFiles = null; };
  }, []);

  useEffect(() => {
    const idleWindow = window as IdleSchedulerWindow;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(() => loadPages(), {
        timeout: 1500,
      });
    } else {
      timeoutId = setTimeout(() => loadPages(), 250);
    }

    return () => {
      if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [loadPages]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Chord follow-up — plain F/O/A within the chord window
      if (chordTimer && !mod && !e.shiftKey && !e.altKey) {
        if (e.code === "KeyF") {
          e.preventDefault();
          e.stopPropagation();
          endChord();
          globalOpenFiles?.();
          return;
        }
        if (e.code === "KeyO") {
          e.preventDefault();
          e.stopPropagation();
          endChord();
          globalOpenOutline?.();
          return;
        }
        if (e.code === "KeyA") {
          e.preventDefault();
          e.stopPropagation();
          endChord();
          globalOpenAction?.();
          return;
        }
        endChord();
      }

      if (!mod) return;

      // ⌘K — chord leader (opens files after CHORD_WINDOW_MS unless overridden)
      if (!e.shiftKey && e.code === "KeyK") {
        e.preventDefault();
        startChord();
        return;
      }

      // ⌘O — files (legacy)
      if (!e.shiftKey && e.code === "KeyO") {
        e.preventDefault();
        globalOpenFiles?.();
        return;
      }

      // ⌘⇧O — outline (legacy)
      if (e.shiftKey && e.code === "KeyO") {
        e.preventDefault();
        globalOpenOutline?.();
        return;
      }

      // ⌘⇧K — actions (legacy)
      if (e.shiftKey && e.code === "KeyK") {
        e.preventDefault();
        globalOpenAction?.();
        return;
      }
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      endChord();
    };
  }, []);

  useEffect(() => {
    if (open && pages.length === 0) {
      const timeoutId = setTimeout(() => loadPages(true), 0);
      return () => clearTimeout(timeoutId);
    }
  }, [loadPages, open, pages.length]);

  useEffect(() => {
    if (!pages.length || pathname === "/") return;

    const slug = decodeURIComponent(pathname.replace(/^\/+/, ""));
    if (pages.some((page) => page.slug === slug)) {
      addRecentSlug(slug);
    }
  }, [pages, pathname]);

  const closePalette = useCallback(() => {
    setOpen(false);
    setSearch("");
    setActiveIndex(0);
  }, []);

  const handleSelect = useCallback(
    (slug: string) => {
      const href = `/${slug}`;
      addRecentSlug(slug);
      setNavigationIntent(href);
      closePalette();
      startNavigation(() => {
        router.push(href);
      });
    },
    [closePalette, router, startNavigation]
  );

  const recentSlugs = useMemo(() => (open ? getRecentSlugs() : []), [open]);

  // Prepare fuzzysort targets (stable across renders for same pages)
  const prepared = useMemo(() =>
    pages.map((page) => ({
      page,
      prepName: fuzzysort.prepare(page.name.replace(/-/g, " ")),
      prepPath: fuzzysort.prepare(page.path),
    })),
    [pages]
  );

  // Build display: when searching → flat ranked list via fuzzysort; otherwise → all pages in a virtualized browser.
  const { recentEntries, searchResults, visibleEntries, visibleRows } = useMemo(() => {
    const empty = {
      recentEntries: [] as PageEntry[],
      searchResults: null as PageEntry[] | null,
      visibleEntries: [] as PageEntry[],
      visibleRows: [] as PaletteRow[],
    };
    if (!pages.length) return empty;

    const recentSet = new Set(recentSlugs);
    const toPageRows = (entries: PageEntry[]): PaletteRow[] =>
      entries.map((page, pageIndex) => ({ type: "page", page, pageIndex }));

    if (query) {
      const normalizedSearch = query.toLowerCase();
      const results = fuzzysort.go(query, prepared, {
        keys: ["prepName", "prepPath"],
        limit: MAX_SEARCH_RESULTS,
        threshold: -1000,
      });

      // Sort: fuzzysort score first, then boost recents within similar scores
      const ranked = results
        .map((r) => ({ page: r.obj.page, score: r.score }))
        .sort((a, b) => {
          const aExact =
            a.page.slug.toLowerCase() === normalizedSearch ||
            a.page.name.replace(/-/g, " ").toLowerCase() === normalizedSearch;
          const bExact =
            b.page.slug.toLowerCase() === normalizedSearch ||
            b.page.name.replace(/-/g, " ").toLowerCase() === normalizedSearch;
          if (aExact !== bExact) return aExact ? -1 : 1;

          const diff = b.score - a.score;
          // Within a tight score band, prefer recents
          if (Math.abs(diff) < 50) {
            const aRecent = recentSet.has(a.page.slug) ? 1 : 0;
            const bRecent = recentSet.has(b.page.slug) ? 1 : 0;
            if (aRecent !== bRecent) return bRecent - aRecent;
          }
          return diff;
        })
        .map((r) => r.page);

      return {
        recentEntries: [],
        searchResults: ranked,
        visibleEntries: ranked,
        visibleRows: toPageRows(ranked),
      };
    }

    const recent = recentSlugs
      .map((slug) => pages.find((p) => p.slug === slug))
      .filter((p): p is PageEntry => !!p);

    const recentSetForDisplay = new Set(recent.map((page) => page.slug));
    const remainingPages = pages.filter((page) => !recentSetForDisplay.has(page.slug));
    const groupedEntries = [...recent, ...remainingPages];
    const rows: PaletteRow[] = [];

    if (recent.length > 0) {
      rows.push({ type: "heading", label: "Recent pages" });
      rows.push(...recent.map((page, pageIndex) => ({ type: "page" as const, page, pageIndex })));
      if (remainingPages.length > 0) {
        rows.push({ type: "heading", label: "All pages" });
        rows.push(...remainingPages.map((page, index) => ({
          type: "page" as const,
          page,
          pageIndex: recent.length + index,
        })));
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
  }, [pages, prepared, query, recentSlugs]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual owns measurement callbacks for this isolated listbox.
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: (index) => visibleRows[index]?.type === "heading" ? PALETTE_HEADING_HEIGHT : PALETTE_ROW_HEIGHT,
    getScrollElement: () => listElement,
    overscan: 8,
  });

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

  const activeRowIndex = useMemo(
    () => visibleRows.findIndex((row) => row.type === "page" && row.pageIndex === activeIndex),
    [activeIndex, visibleRows]
  );

  useEffect(() => {
    if (!open || loading) return;

    const timeoutId = setTimeout(() => {
      const page = searchResults?.[0] ?? recentEntries[0];
      if (page) {
        router.prefetch(`/${page.slug}`);
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [loading, open, recentEntries, router, searchResults]);

  const moveActive = useCallback((delta: number) => {
    setActiveIndex((current) => {
      if (visibleEntries.length === 0) return 0;
      const next = Math.min(Math.max(current + delta, 0), visibleEntries.length - 1);
      const nextRowIndex = visibleRows.findIndex((row) => row.type === "page" && row.pageIndex === next);
      rowVirtualizer.scrollToIndex(nextRowIndex === -1 ? next : nextRowIndex, { align: "auto" });
      return next;
    });
  }, [rowVirtualizer, visibleEntries.length, visibleRows]);

  const selectActive = useCallback(() => {
    const page = visibleEntries[activeIndex];
    if (page) {
      handleSelect(page.slug);
    }
  }, [activeIndex, handleSelect, visibleEntries]);

  const onInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
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
      rowVirtualizer.scrollToIndex(firstRowIndex === -1 ? 0 : firstRowIndex, { align: "start" });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const last = Math.max(0, visibleEntries.length - 1);
      setActiveIndex(last);
      const lastRowIndex = visibleRows.findIndex((row) => row.type === "page" && row.pageIndex === last);
      rowVirtualizer.scrollToIndex(lastRowIndex === -1 ? last : lastRowIndex, { align: "end" });
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
  }, [closePalette, moveActive, rowVirtualizer, selectActive, visibleEntries.length, visibleRows]);

  return (
    <>
      {isNavigating ? (
        <div
          className="fixed inset-x-0 top-0 z-[60] h-0.5 bg-transparent"
          role="status"
          aria-label="Opening page"
        >
          <div className="h-full w-full animate-pulse bg-[var(--brand)]/60" />
        </div>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setOpen(true);
          } else {
            closePalette();
          }
        }}
      >
        {open ? (
          <DialogContent
            className="top-[10%] sm:top-1/4 translate-y-0 overflow-hidden rounded-xl! p-0 max-w-[calc(100%-1rem)] sm:max-w-xl"
            showCloseButton={false}
          >
            <DialogHeader className="sr-only">
              <DialogTitle>Go to page</DialogTitle>
              <DialogDescription>Search pages</DialogDescription>
            </DialogHeader>
            <div className="flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground">
              <div className="p-1 pb-2">
                <div className="relative flex h-8! w-full min-w-0 items-center rounded-lg! border border-input/30 bg-input/30 shadow-none!">
                  <input
                    aria-activedescendant={visibleEntries[activeIndex] ? `page-palette-${activeIndex}` : undefined}
                    aria-controls="page-palette-list"
                    aria-expanded={open}
                    aria-label="Search pages"
                    autoComplete="off"
                    className="w-full bg-transparent px-2 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                    data-slot="command-input"
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setActiveIndex(0);
                      rowVirtualizer.scrollToIndex(0, { align: "start" });
                    }}
                    onKeyDown={onInputKeyDown}
                    placeholder="Search pages…"
                    role="combobox"
                    value={search}
                  />
                  <SearchIcon />
                </div>
              </div>
              <div
                className="no-scrollbar max-h-[60dvh] sm:max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none"
                id="page-palette-list"
                ref={setListElement}
                role="listbox"
              >
                {loading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin mr-2" />
                    <span className="text-sm">Loading pages…</span>
                  </div>
                ) : (
                  <>
                    {visibleEntries.length === 0 ? (
                      <div className="py-6 text-center text-sm">No pages found.</div>
                    ) : (
                      <VirtualizedPageEntries
                        activeIndex={activeIndex}
                        activeRowIndex={activeRowIndex}
                        onActiveIndexChange={setActiveIndex}
                        onSelect={handleSelect}
                        rows={visibleRows}
                        rowVirtualizer={rowVirtualizer}
                        valueMode={query ? "slug" : "label"}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function VirtualizedPageEntries({
  activeIndex,
  activeRowIndex,
  onActiveIndexChange,
  onSelect,
  rows,
  rowVirtualizer,
  valueMode,
}: {
  activeIndex: number;
  activeRowIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (slug: string) => void;
  rows: PaletteRow[];
  rowVirtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  valueMode: "label" | "slug";
}) {
  "use no memo";

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div aria-label="Pages" role="group">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index];
          if (!row) return null;

          if (row.type === "heading") {
            return (
              <div
                key={`${row.label}-${virtualItem.index}`}
                className="absolute left-0 top-0 flex h-7 w-full items-end px-2 pb-1 text-xs font-medium text-muted-foreground"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {row.label}
              </div>
            );
          }

          const page = row.page;
          const group = getGroup(page.slug);
          const selected = row.pageIndex === activeIndex;
          const value = valueMode === "slug"
            ? page.slug
            : `${page.name} ${page.path} ${group}`;

          return (
            <button
              key={page.slug}
              ref={rowVirtualizer.measureElement}
              {...{ "cmdk-item": "" }}
              aria-selected={selected}
              data-index={virtualItem.index}
              data-page-index={row.pageIndex}
              data-selected={selected ? "true" : undefined}
              data-value={value}
              id={`page-palette-${row.pageIndex}`}
              onClick={() => onSelect(page.slug)}
              onMouseEnter={() => onActiveIndexChange(row.pageIndex)}
              role="option"
              type="button"
              className={cn(
                "absolute left-0 top-0 flex h-14 w-full cursor-default items-center gap-2 rounded-lg px-2 py-2 text-left text-sm outline-hidden select-none",
                selected && "bg-muted text-foreground",
                virtualItem.index === activeRowIndex && "z-10"
              )}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <FileTextIcon className="mr-2 size-4 shrink-0 opacity-50 self-start mt-0.5" />
              <div className="flex flex-col min-w-0">
                <span className="truncate">{page.name.replace(/-/g, " ")}</span>
                <span className="text-xs text-muted-foreground truncate">{formatPath(page.slug)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getGroup(slug: string): string {
  const parts = slug.split("/");
  return parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[0] : "";
}

function formatPath(slug: string): string {
  const parts = slug.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "/";
}

// ─── Outline palette (Cmd+Shift+O) ───────────────────────────────────────────

export function openOutlinePalette() {
  globalOpenOutline?.();
}

function isVisible(element: HTMLElement) {
  return element.offsetParent !== null || element.getClientRects().length > 0;
}

function getOutlineRoot() {
  const articles = Array.from(document.querySelectorAll<HTMLElement>("article"));
  return articles.find(isVisible) ?? null;
}

function getOutlineHeadingText(heading: HTMLHeadingElement) {
  const clone = heading.cloneNode(true) as HTMLHeadingElement;
  clone
    .querySelectorAll('a[href^="#"], a[aria-hidden="true"], .anchor, .header-anchor, .hash-link, .heading-anchor')
    .forEach((anchor) => anchor.remove());

  const text = clone.textContent ?? heading.textContent ?? "";
  return text
    .replace(/^#{1,6}\s*/, "")
    .replace(/(?:\s*#\s*)+$/, "")
    .trim();
}

function getOutlineHeadingElements(root = getOutlineRoot()) {
  if (!root) return [];

  return Array.from(
    root.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6")
  ).filter((heading) => getOutlineHeadingText(heading).length > 0);
}

function getOutlineHeadings(): OutlineHeading[] {
  return getOutlineHeadingElements().map((heading, index) => {
    const id = heading.id || null;
    return {
      key: id ? `id:${id}` : `index:${index}`,
      id,
      index,
      level: Number.parseInt(heading.tagName.slice(1), 10),
      text: getOutlineHeadingText(heading),
    };
  });
}

function getScrollContainer(element: HTMLElement | null) {
  if (!element) return null;

  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
}

function scrollElementIntoContainerView(target: HTMLElement) {
  const scrollContainer = getScrollContainer(target);
  if (!scrollContainer) return;

  const offset = 24;
  const targetRect = target.getBoundingClientRect();

  if (
    scrollContainer === document.documentElement ||
    scrollContainer === document.body ||
    scrollContainer === document.scrollingElement
  ) {
    window.scrollTo({
      top: Math.max(0, window.scrollY + targetRect.top - offset),
      behavior: "smooth",
    });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const nextTop = scrollContainer.scrollTop + targetRect.top - containerRect.top - offset;
  scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

function getElementForHeading(item: OutlineHeading) {
  const root = getOutlineRoot();
  if (!root) return null;

  if (item.id) {
    return root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`) ?? document.getElementById(item.id);
  }

  return getOutlineHeadingElements(root)[item.index] ?? null;
}

export function OutlinePalette() {
  const [open, setOpen] = useState(false);
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  const [search, setSearch] = useState("");
  const pathname = usePathname();
  const listRef = useRef<HTMLDivElement>(null);

  const refreshHeadings = useCallback(() => {
    setHeadings(getOutlineHeadings());
  }, []);

  useEffect(() => {
    globalOpenOutline = () => {
      refreshHeadings();
      setOpen(true);
    };
    return () => { globalOpenOutline = null; };
  }, [refreshHeadings]);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset dialog query after close
      setSearch("");
      return;
    }

    refreshHeadings();
    const root = getOutlineRoot();
    if (!root) return;

    const observer = new MutationObserver(refreshHeadings);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [open, pathname, refreshHeadings]);

  const handleSelect = useCallback((item: OutlineHeading) => {
    const target = getElementForHeading(item);
    if (!target) return;

    if (item.id) {
      window.history.pushState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#${encodeURIComponent(item.id)}`
      );
    }

    if (!target.hasAttribute("tabindex")) {
      target.tabIndex = -1;
    }

    setOpen(false);
    requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      scrollElementIntoContainerView(target);
    });
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Outline" description="Jump to a heading">
      <Command>
        <CommandInput
          placeholder="Search headings…"
          value={search}
          onValueChange={(v) => {
            setSearch(v);
            requestAnimationFrame(() => listRef.current?.scrollTo(0, 0));
          }}
        />
        <CommandList ref={listRef}>
          <CommandEmpty>
            {headings.length === 0 ? "No headings found on this page." : "No matching headings."}
          </CommandEmpty>
          {headings.length > 0 ? (
            <CommandGroup heading="Headings">
              {headings.map((heading) => (
                <CommandItem
                  key={heading.key}
                  value={`${heading.text} h${heading.level} ${heading.id ?? ""}`}
                  onSelect={() => handleSelect(heading)}
                  className="py-2.5"
                >
                  <HeadingIcon className="mr-2 size-4 shrink-0 opacity-50 self-start mt-0.5" />
                  <div
                    className="flex min-w-0 flex-1 flex-col"
                    style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 10}px` }}
                  >
                    <span className="truncate">{heading.text}</span>
                    {heading.id ? (
                      <span className="truncate text-xs text-muted-foreground">#{heading.id}</span>
                    ) : null}
                  </div>
                  <CommandShortcut className="tracking-normal">H{heading.level}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

// ─── Action palette (Cmd+K A / Cmd+Shift+K) ─────────────────────────────────

export function ActionPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const preference = useSyncExternalStore(subscribeTheme, getThemePref, getThemePrefServer);
  const currentTheme = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    }, []),
    () => themeEffect(),
    () => "light",
  );

  const themeLabel = preference === null ? "System" : preference === "dark" ? "Dark" : "Light";

  useEffect(() => {
    globalOpenAction = () => setOpen(true);
    return () => { globalOpenAction = null; };
  }, []);

  function cycleTheme() {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    let newPref: string | null;
    if (preference === null) {
      newPref = systemTheme === "dark" ? "light" : "dark";
    } else if (preference === "dark") {
      newPref = "light";
    } else {
      newPref = null;
    }
    if (newPref === null) {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", newPref);
    }
    themeEffect();
    notifyTheme();
    setOpen(false);
  }

  function useSystemTheme() {
    localStorage.removeItem("theme");
    themeEffect();
    notifyTheme();
    setOpen(false);
  }

  function download(type: "full" | "markdown") {
    setOpen(false);
    window.location.href = `/api/download?type=${type}`;
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Commands" description="Run an action">
      <Command>
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandGroup heading="Theme">
            <CommandItem
              value={`theme toggle ${currentTheme === "dark" ? "light" : "dark"}`}
              onSelect={cycleTheme}
            >
              {currentTheme === "dark" ? <SunIcon /> : <MoonIcon />}
              <span className="ml-2">
                Switch to {currentTheme === "dark" ? "Light" : "Dark"} theme
              </span>
              <span className="ml-auto text-xs text-muted-foreground">Current: {themeLabel}</span>
            </CommandItem>
            <CommandItem value="theme system auto" onSelect={useSystemTheme}>
              <MonitorIcon />
              <span className="ml-2">Use system theme</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Download">
            <CommandItem value="download wiki full zip archive" onSelect={() => download("full")}>
              <DownloadIcon />
              <span className="ml-2">Download wiki — full zip</span>
            </CommandItem>
            <CommandItem value="download wiki markdown md files" onSelect={() => download("markdown")}>
              <DownloadIcon />
              <span className="ml-2">Download wiki — markdown only</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Navigate">
            <CommandItem value="files pages palette" onSelect={() => { setOpen(false); openCommandPalette(); }}>
              <FileTextIcon />
              <span className="ml-2">Find files</span>
              <CommandShortcut>⌘K F</CommandShortcut>
            </CommandItem>
            <CommandItem value="outline headings headers current page" onSelect={() => { setOpen(false); openOutlinePalette(); }}>
              <ListTreeIcon />
              <span className="ml-2">Open outline</span>
              <CommandShortcut>⌘K O</CommandShortcut>
            </CommandItem>
            <CommandItem value="search full text" onSelect={() => { setOpen(false); router.push("/search"); }}>
              <SearchIcon />
              <span className="ml-2">Open search</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Tools">
            <CommandItem value="medical deduction calculator tax planner" onSelect={() => { setOpen(false); router.push("/tools/medical-deduction"); }}>
              <CalculatorIcon className="size-4 shrink-0 opacity-70" />
              <span className="ml-2">Medical deduction calculator</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
