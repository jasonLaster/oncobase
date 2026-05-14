import { describe, expect, test } from "bun:test";
import {
  buildWikiFilePaletteState,
  formatWikiFilePalettePath,
} from "./file-palette";

const pages = [
  {
    name: "Insurance",
    slug: "wiki/logistics/insurance",
    path: "wiki / logistics / insurance",
  },
  {
    name: "Medical Team",
    slug: "wiki/people/medical-team",
    path: "wiki / people / medical-team",
  },
  {
    name: "Search",
    slug: "search",
    path: "search",
  },
  {
    name: "Research Review",
    slug: "wiki/research/research-review",
    path: "wiki / research / research-review",
  },
];

describe("wiki file palette model", () => {
  test("shows recent pages before the full page list when idle", () => {
    const state = buildWikiFilePaletteState(pages, "", [
      "wiki/people/medical-team",
      "wiki/logistics/insurance",
    ]);

    expect(state.recentEntries.map((page) => page.slug)).toEqual([
      "wiki/people/medical-team",
      "wiki/logistics/insurance",
    ]);
    expect(state.visibleRows.slice(0, 4)).toEqual([
      { type: "heading", label: "Recent pages" },
      { type: "page", page: pages[1], pageIndex: 0 },
      { type: "page", page: pages[0], pageIndex: 1 },
      { type: "heading", label: "All pages" },
    ]);
  });

  test("shows all pages when there are no recents", () => {
    const state = buildWikiFilePaletteState(pages, "", []);

    expect(state.visibleEntries.map((page) => page.slug)).toEqual(
      pages.map((page) => page.slug),
    );
    expect(state.visibleRows).toEqual(
      pages.map((page, pageIndex) => ({ type: "page", page, pageIndex })),
    );
  });

  test("uses fuzzy search with exact matches before broad fuzzy matches", () => {
    const state = buildWikiFilePaletteState(pages, "search", [
      "wiki/research/research-review",
    ]);

    expect(state.searchResults?.map((page) => page.slug).slice(0, 2)).toEqual([
      "search",
      "wiki/research/research-review",
    ]);
    expect(state.visibleRows[0]).toEqual({
      type: "page",
      page: pages[2],
      pageIndex: 0,
    });
  });

  test("boosts recent pages within a close fuzzy score band", () => {
    const state = buildWikiFilePaletteState(pages, "medical", [
      "wiki/people/medical-team",
    ]);

    expect(state.searchResults?.at(0)?.slug).toBe("wiki/people/medical-team");
  });

  test("formats root-level page paths as root", () => {
    expect(formatWikiFilePalettePath("search")).toBe("/");
  });
});
