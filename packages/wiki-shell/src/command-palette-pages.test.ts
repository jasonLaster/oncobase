import { describe, expect, test } from "bun:test";
import {
  buildCommandPaletteRows,
  commandPalettePagesFromCompactFileTree,
  formatCommandPalettePagePath,
  getCommandPalettePageGroup,
  prepareCommandPalettePages,
  type CommandPalettePageEntry,
} from "./command-palette-pages";

const pages: CommandPalettePageEntry[] = [
  { name: "Insurance", slug: "wiki/logistics/insurance", path: "wiki/logistics" },
  { name: "Treatment Plan", slug: "wiki/treatment/plan", path: "wiki/treatment" },
  { name: "Diagnosis", slug: "wiki/diagnostics/diagnosis", path: "wiki/diagnostics" },
  { name: "About", slug: "about/About", path: "about" },
];

describe("buildCommandPaletteRows", () => {
  test("groups recent then all when no query", () => {
    const result = buildCommandPaletteRows({
      pages,
      prepared: prepareCommandPalettePages(pages),
      query: "",
      recentSlugs: ["wiki/treatment/plan", "wiki/logistics/insurance"],
    });
    expect(result.searchResults).toBeNull();
    expect(result.visibleEntries.map((page) => page.slug)).toEqual([
      "wiki/treatment/plan",
      "wiki/logistics/insurance",
      "wiki/diagnostics/diagnosis",
      "about/About",
    ]);
    expect(result.visibleRows[0]).toEqual({ type: "heading", label: "Recent pages" });
    expect(
      result.visibleRows.filter((row) => row.type === "heading").map((row) =>
        row.type === "heading" ? row.label : null,
      ),
    ).toEqual(["Recent pages", "All pages"]);
  });

  test("returns flat ranked list when query is set and recents sit above ties", () => {
    const result = buildCommandPaletteRows({
      pages,
      prepared: prepareCommandPalettePages(pages),
      query: "insurance",
      recentSlugs: ["wiki/logistics/insurance"],
    });
    expect(result.searchResults).not.toBeNull();
    expect(result.visibleEntries[0]?.slug).toBe("wiki/logistics/insurance");
    expect(result.visibleRows.every((row) => row.type === "page")).toBe(true);
  });

  test("returns empty rows for empty pages", () => {
    const result = buildCommandPaletteRows({
      pages: [],
      prepared: [],
      query: "anything",
      recentSlugs: [],
    });
    expect(result.visibleRows).toEqual([]);
    expect(result.visibleEntries).toEqual([]);
  });
});

describe("commandPalettePagesFromCompactFileTree", () => {
  test("derives searchable pages from compact file nodes", () => {
    const result = commandPalettePagesFromCompactFileTree([
      [
        "d",
        "wiki",
        [
          ["f", "index"],
          ["f", "chemo-day"],
          ["p", "protocol"],
          ["f", "raw-export.csv"],
        ],
      ],
      ["f", "About", "about/About"],
    ]);

    expect(result).toEqual([
      { name: "index", slug: "wiki/index", path: "wiki / index" },
      { name: "chemo-day", slug: "wiki/chemo-day", path: "wiki / chemo-day" },
      { name: "About", slug: "about/About", path: "about / About" },
    ]);
  });

  test("honors relative compact slug overrides", () => {
    const result = commandPalettePagesFromCompactFileTree([
      ["d", "about", [["f", "Journal", "../journal/Journal"]]],
      ["d", "wiki", [["d", "treatment", [["f", "plan", "./plans/current"]]]]],
    ]);

    expect(result.map((page) => page.slug)).toEqual([
      "journal/Journal",
      "wiki/treatment/plans/current",
    ]);
  });
});

describe("page slug helpers", () => {
  test("getCommandPalettePageGroup returns the second segment for deep slugs", () => {
    expect(getCommandPalettePageGroup("wiki/logistics/insurance")).toBe("logistics");
    expect(getCommandPalettePageGroup("about/About")).toBe("about");
    expect(getCommandPalettePageGroup("index")).toBe("");
  });

  test("formatCommandPalettePagePath returns the directory portion", () => {
    expect(formatCommandPalettePagePath("wiki/logistics/insurance")).toBe(
      "wiki/logistics",
    );
    expect(formatCommandPalettePagePath("about/About")).toBe("about");
    expect(formatCommandPalettePagePath("index")).toBe("/");
  });
});
