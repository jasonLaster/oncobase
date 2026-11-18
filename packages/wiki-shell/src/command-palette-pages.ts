import { safeLocalStorage } from "@oncobase/safe-storage";
import fuzzysort from "fuzzysort";
import { getNoteBundlePages } from "./note-bundles.ts";

export const COMMAND_PALETTE_RECENT_KEY = "cmd-palette-recent";
export const COMMAND_PALETTE_MAX_RECENT = 8;
export const COMMAND_PALETTE_MAX_SEARCH_RESULTS = 50;
export const COMMAND_PALETTE_ROW_HEIGHT = 56;
export const COMMAND_PALETTE_HEADING_HEIGHT = 28;

export type CommandPalettePageEntry = {
  name: string;
  title?: string;
  slug: string;
  path: string;
  /** Host prior, about -0.3 to 0.3 on the 0–1 relevance scale: curated
   * pages up, archives and clippings down, newer records slightly up. */
  boost?: number;
};

export type CommandPaletteCompactFileNode =
  | ["d", string, CommandPaletteCompactFileNode[], (string | null)?, string?]
  | ["f", string, string?]
  | ["p", string, string?];

export type CommandPalettePreparedPage = {
  page: CommandPalettePageEntry;
  prepName: Fuzzysort.Prepared;
  prepTitle: Fuzzysort.Prepared;
  prepPath: Fuzzysort.Prepared;
  /** Normalized once here so a keystroke never re-normalizes every page. */
  normName: string;
  normTitle: string;
  normSlug: string;
  titleWords: number;
  /** Words of the title, name and path, for whole-word prefix matching. */
  words: string[];
};

export type CommandPaletteRow =
  | { type: "heading"; label: string }
  | { type: "page"; page: CommandPalettePageEntry; pageIndex: number };

export type CommandPaletteRowSet = {
  recentEntries: CommandPalettePageEntry[];
  searchResults: CommandPalettePageEntry[] | null;
  visibleEntries: CommandPalettePageEntry[];
  visibleRows: CommandPaletteRow[];
};

export function getCommandPaletteRecentSlugs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = safeLocalStorage.getItem(COMMAND_PALETTE_RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addCommandPaletteRecentSlug(slug: string) {
  if (typeof window === "undefined") return;
  const recent = getCommandPaletteRecentSlugs().filter((entry) => entry !== slug);
  recent.unshift(slug);
  if (recent.length > COMMAND_PALETTE_MAX_RECENT) {
    recent.length = COMMAND_PALETTE_MAX_RECENT;
  }
  try {
    safeLocalStorage.setItem(
      COMMAND_PALETTE_RECENT_KEY,
      JSON.stringify(recent),
    );
  } catch {
    // Storage quota exceeded — silently ignore; recents are a convenience.
  }
}

export function prepareCommandPalettePages(
  pages: CommandPalettePageEntry[],
): CommandPalettePreparedPage[] {
  return pages.map((page) => {
    const normTitle = normalize(page.title ?? page.name);
    return {
      page,
      prepName: fuzzysort.prepare(page.name.replace(/-/g, " ")),
      prepTitle: fuzzysort.prepare(page.title ?? page.name),
      prepPath: fuzzysort.prepare(page.path),
      normName: normalize(page.name),
      normTitle,
      normSlug: page.slug.toLowerCase(),
      titleWords: normTitle.split(" ").length,
      words: [...new Set(wordsOf(`${page.title ?? ""} ${page.name} ${page.slug}`))],
    };
  });
}

function normalize(text: string) {
  return text.replace(/-/g, " ").trim().toLowerCase().replace(/\s+/g, " ");
}

function wordsOf(text: string) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** "taxes" → "tax", "meds" → "med": plural endings only, never short words. */
function stem(word: string) {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Share of query words that begin some word of the page, in any order. */
function wordCoverage(terms: string[], words: string[]) {
  let hits = 0;
  for (const term of terms) {
    for (const word of words) {
      if (word.startsWith(term)) { hits++; break; }
    }
  }
  return hits / terms.length;
}

function childSlug(parentSlug: string, name: string) {
  return parentSlug ? `${parentSlug}/${name}` : name;
}

function resolveRelativeSlug(parentSlug: string, override: string) {
  const segments = parentSlug.split("/").filter(Boolean);
  for (const part of override.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

function expandCompactSlug(parentSlug: string, name: string, override?: string) {
  if (!override) return childSlug(parentSlug, name);
  if (
    override === "." ||
    override === ".." ||
    override.startsWith("../") ||
    override.startsWith("./")
  ) {
    return resolveRelativeSlug(parentSlug, override);
  }
  return override.includes("/") ? override : childSlug(parentSlug, override);
}

function isExtensionlessPageSlug(slug: string) {
  const lastSegment = slug.split("/").filter(Boolean).at(-1);
  return Boolean(lastSegment && !lastSegment.includes("."));
}

export function commandPalettePagesFromCompactFileTree(
  tree: CommandPaletteCompactFileNode[],
): CommandPalettePageEntry[] {
  const pages: CommandPalettePageEntry[] = [];

  const visit = (nodes: CommandPaletteCompactFileNode[], parentSlug = "") => {
    for (const node of nodes) {
      const [type, name] = node;
      if (type === "d") {
        visit(node[2], expandCompactSlug(parentSlug, name, node[4]));
        continue;
      }

      if (type !== "f") continue;

      const slug = expandCompactSlug(parentSlug, name, node[2]);
      if (!isExtensionlessPageSlug(slug)) continue;

      pages.push({
        name: slug.split("/").at(-1) ?? name,
        slug,
        path: slug.split("/").join(" / "),
      });
    }
  };

  visit(tree);
  return pages;
}

function noteBundleOverviewSlugs(pages: CommandPalettePageEntry[]) {
  const slugs = new Set(pages.map((page) => page.slug));
  const overviewBySlug = new Map<string, string>();

  // Match the file tree's Notes set rule: overview, raw, and at least one
  // formatted sibling must all exist in the same directory.
  for (const page of pages) {
    if (!page.slug.endsWith("-overview")) continue;
    const siblings = getNoteBundlePages(page.slug, slugs);
    if (!siblings.some(({ part }) => part === "raw") ||
        !siblings.some(({ part }) => part === "formatted")) continue;
    for (const sibling of siblings) {
      if (sibling.slug !== page.slug) overviewBySlug.set(sibling.slug, page.slug);
    }
  }

  return overviewBySlug;
}

/**
 * Returns the visible row set for the file palette: a flat ranked list while
 * the user is searching, or recents-grouped browsing when the query is empty.
 *
 * Exact names/slugs and complete multiword titles with a short query suffix
 * rank first. Recency adds a small bonus on fuzzysort v3's 0–1 score scale.
 */
export function buildCommandPaletteRows({
  pages,
  prepared,
  query,
  recentSlugs,
  recommendedSlugs = [],
}: {
  pages: CommandPalettePageEntry[];
  prepared: CommandPalettePreparedPage[];
  query: string;
  recentSlugs: string[];
  /** Pages a host recommends for this query (best first), listed above the matches. */
  recommendedSlugs?: string[];
}): CommandPaletteRowSet {
  const empty: CommandPaletteRowSet = {
    recentEntries: [],
    searchResults: null,
    visibleEntries: [],
    visibleRows: [],
  };
  if (!pages.length) return empty;

  const overviewBySlug = noteBundleOverviewSlugs(pages);
  if (overviewBySlug.size > 0) {
    pages = pages.filter((page) => !overviewBySlug.has(page.slug));
    prepared = prepared.filter(({ page }) => !overviewBySlug.has(page.slug));
    recentSlugs = [...new Set(recentSlugs.map((slug) => overviewBySlug.get(slug) ?? slug))];
  }

  const recentSet = new Set(recentSlugs);
  const toPageRows = (entries: CommandPalettePageEntry[]): CommandPaletteRow[] =>
    entries.map((page, pageIndex) => ({ type: "page", page, pageIndex }));

  const normalizedSearch = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalizedSearch) {
    const fuzzy = new Map<string, number>();
    for (const result of fuzzysort.go(normalizedSearch, prepared, {
      keys: ["prepName", "prepTitle", "prepPath"],
      threshold: 0,
    })) fuzzy.set(result.obj.page.slug, result.score);

    // One pass over the prepared pages. A page qualifies by fuzzy match, by
    // its exact or complete title, or by whole words: every query word (most
    // of them, from three words) begins one of its words, in any order.
    const queryWords = normalizedSearch.split(" ");
    // A single letter begins nearly every page's words: leave it to fuzzy matching.
    const terms = [...new Set(wordsOf(normalizedSearch).map(stem))].filter((term) => term.length > 1);
    const stemmedSearch = queryWords.map(stem).join(" ");
    const minimum = terms.length >= 3 ? (terms.length - 1) / terms.length : 1;
    const candidates: Array<{ page: CommandPalettePageEntry; score: number; titleRank: number }> = [];
    for (const entry of prepared) {
      const { page } = entry;
      const exact = entry.normTitle === normalizedSearch || entry.normSlug === normalizedSearch ||
        entry.normName === normalizedSearch || entry.normName === stemmedSearch || entry.normTitle === stemmedSearch;
      // A complete, substantial title followed by a short suffix (e.g. "should").
      const completeTitle = entry.titleWords >= 3 &&
        entry.titleWords / queryWords.length >= 0.75 && normalizedSearch.startsWith(`${entry.normTitle} `);
      const coverage = terms.length ? wordCoverage(terms, entry.words) : 0;
      const fuzzyScore = fuzzy.get(page.slug);
      if (fuzzyScore === undefined && !exact && !completeTitle && coverage < minimum) continue;
      // Exact and complete titles rank first. Within a tier, whole words and
      // fuzzy closeness weigh the same and the host's prior (curated over
      // archived, newer over older) settles near-ties. Bounded additive
      // bonuses keep the comparator transitive.
      const score = 0.5 * (fuzzyScore ?? 0) + 0.5 * coverage +
        (page.boost ?? 0) + (recentSet.has(page.slug) ? 0.05 : 0);
      candidates.push({ page, score, titleRank: exact ? 2 : completeTitle ? 1 : 0 });
    }

    // Rank before limiting so title, whole-word and recent hits cannot be
    // discarded by fuzzysort's own cutoff.
    const ranked = candidates
      .sort((a, b) => b.titleRank - a.titleRank || b.score - a.score)
      .slice(0, COMMAND_PALETTE_MAX_SEARCH_RESULTS)
      .map((result) => result.page);

    // A recommended note-bundle sibling stands for its overview, as in browsing.
    const bySlug = new Map(pages.map((page) => [page.slug, page]));
    const recommended = [...new Set(recommendedSlugs.map((slug) => overviewBySlug.get(slug) ?? slug))]
      .map((slug) => bySlug.get(slug))
      .filter((page): page is CommandPalettePageEntry => Boolean(page));
    if (recommended.length > 0) {
      const shown = new Set(recommended.map((page) => page.slug));
      const matches = ranked.filter((page) => !shown.has(page.slug));
      const visibleEntries = [...recommended, ...matches];
      const visibleRows: CommandPaletteRow[] = [
        { type: "heading", label: "Recommended" },
        ...recommended.map((page, pageIndex) => ({ type: "page" as const, page, pageIndex })),
        ...(matches.length > 0 ? [{ type: "heading" as const, label: "Matches" }] : []),
        ...matches.map((page, index) => ({ type: "page" as const, page, pageIndex: recommended.length + index })),
      ];
      return { recentEntries: [], searchResults: visibleEntries, visibleEntries, visibleRows };
    }

    return {
      recentEntries: [],
      searchResults: ranked,
      visibleEntries: ranked,
      visibleRows: toPageRows(ranked),
    };
  }

  const recent = recentSlugs
    .map((slug) => pages.find((page) => page.slug === slug))
    .filter((page): page is CommandPalettePageEntry => Boolean(page));
  const recentSetForDisplay = new Set(recent.map((page) => page.slug));
  const remainingPages = pages.filter(
    (page) => !recentSetForDisplay.has(page.slug),
  );
  const visibleEntries = [...recent, ...remainingPages];
  const visibleRows: CommandPaletteRow[] = [];

  if (recent.length > 0) {
    visibleRows.push({ type: "heading", label: "Recent pages" });
    visibleRows.push(
      ...recent.map((page, pageIndex) => ({
        type: "page" as const,
        page,
        pageIndex,
      })),
    );
    if (remainingPages.length > 0) {
      visibleRows.push({ type: "heading", label: "All pages" });
      visibleRows.push(
        ...remainingPages.map((page, index) => ({
          type: "page" as const,
          page,
          pageIndex: recent.length + index,
        })),
      );
    }
  } else {
    visibleRows.push(...toPageRows(pages));
  }

  return {
    recentEntries: recent,
    searchResults: null,
    visibleEntries,
    visibleRows,
  };
}

export function getCommandPalettePageGroup(slug: string): string {
  const parts = slug.split("/");
  if (parts.length >= 3) return parts[1];
  if (parts.length === 2) return parts[0];
  return "";
}

export function formatCommandPalettePagePath(slug: string): string {
  const parts = slug.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "/";
}
