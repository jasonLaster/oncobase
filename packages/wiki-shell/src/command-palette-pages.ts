import fuzzysort from "fuzzysort";

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
    const raw = window.localStorage.getItem(COMMAND_PALETTE_RECENT_KEY);
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
    window.localStorage.setItem(
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
  return pages.map((page) => ({
    page,
    prepName: fuzzysort.prepare(page.name.replace(/-/g, " ")),
    prepTitle: fuzzysort.prepare(page.title ?? page.name),
    prepPath: fuzzysort.prepare(page.path),
  }));
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
}: {
  pages: CommandPalettePageEntry[];
  prepared: CommandPalettePreparedPage[];
  query: string;
  recentSlugs: string[];
}): CommandPaletteRowSet {
  const empty: CommandPaletteRowSet = {
    recentEntries: [],
    searchResults: null,
    visibleEntries: [],
    visibleRows: [],
  };
  if (!pages.length) return empty;

  const recentSet = new Set(recentSlugs);
  const toPageRows = (entries: CommandPalettePageEntry[]): CommandPaletteRow[] =>
    entries.map((page, pageIndex) => ({ type: "page", page, pageIndex }));

  const normalizedSearch = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalizedSearch) {
    const results = fuzzysort.go(normalizedSearch, prepared, {
      keys: ["prepName", "prepTitle", "prepPath"],
      threshold: 0,
    });
    const candidates = new Map(
      results.map((result) => [
        result.obj.page.slug,
        { page: result.obj.page, score: result.score, titleRank: 0 },
      ]),
    );

    // Fuzzy search requires every query character to match. Also admit a
    // complete, substantial title followed by a short suffix (e.g. "should").
    // Keep short titles and queries with substantial extra terms restrictive.
    const queryWordCount = normalizedSearch.split(" ").length;
    for (const page of pages) {
      const name = (page.title ?? page.name).replace(/-/g, " ").trim().toLowerCase().replace(/\s+/g, " ");
      const wordCount = name.split(" ").length;
      const exact = name === normalizedSearch || page.slug.toLowerCase() === normalizedSearch ||
        page.name.replace(/-/g, " ").trim().toLowerCase() === normalizedSearch;
      const completeTitle = wordCount >= 3 &&
        wordCount / queryWordCount >= 0.75 && normalizedSearch.startsWith(`${name} `);
      const titleRank = exact ? 2 : completeTitle ? 1 : 0;
      if (titleRank) {
        candidates.set(page.slug, {
          page,
          score: exact ? 1 : wordCount / queryWordCount,
          titleRank,
        });
      }
    }

    // Rank before limiting so title matches and close recent hits cannot be
    // discarded by fuzzysort's own top-50 cutoff. A bounded additive bonus
    // also keeps the comparator transitive, unlike pairwise score bands.
    const scoreWithRecency = (result: { page: CommandPalettePageEntry; score: number }) =>
      result.score + (recentSet.has(result.page.slug) ? 0.02 : 0);
    const ranked = [...candidates.values()]
      .sort((a, b) => b.titleRank - a.titleRank || scoreWithRecency(b) - scoreWithRecency(a))
      .slice(0, COMMAND_PALETTE_MAX_SEARCH_RESULTS)
      .map((result) => result.page);

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
