import { describe, expect, test } from "bun:test";
import {
  buildCommandPaletteRows,
  commandPalettePagesFromCompactFileTree,
  formatCommandPalettePagePath,
  getCommandPalettePageGroup,
  prepareCommandPalettePages,
  type CommandPalettePageEntry,
} from "./command-palette-pages.ts";

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

  test.each(["Breast sensation after surgery", "Breast sensation after surgery should"])(
    "ranks the complete title first for %s even with recent competing pages",
    (query) => {
      const target = {
        name: "index",
        title: "Breast sensation after surgery",
        slug: "sources/research/papers/breast-sensation/index",
        path: "sources / research / papers / breast-sensation / index",
      };
      const competing = {
        name: "Breast sensation after surgery: what should patients expect?",
        slug: "wiki/questions/surgery",
        path: "wiki / questions / surgery",
      };
      const candidates = [competing, target];
      const result = buildCommandPaletteRows({
        pages: candidates,
        prepared: prepareCommandPalettePages(candidates),
        query,
        recentSlugs: [competing.slug],
      });
      expect(result.visibleEntries[0]).toEqual(target);
    },
  );

  test("searches title fragments while preserving the filename label and lookup", () => {
    const target = { name: "index", title: "Breast sensation after surgery", slug: "sources/sensation/index", path: "sources" };
    for (const query of ["sensation after", "index"]) {
      const result = buildCommandPaletteRows({
        pages: [target],
        prepared: prepareCommandPalettePages([target]),
        query,
        recentSlugs: [],
      });
      expect(result.visibleEntries).toEqual([target]);
      expect(result.visibleEntries[0]?.name).toBe("index");
    }
  });

  test("does not let a weak recent match outrank a strong title match", () => {
    const candidates = [
      { name: "Breast sensation after surgery", slug: "sources/sensation", path: "sources" },
      { name: "Breast reconstruction and sensory rehabilitation", slug: "wiki/rehab", path: "wiki" },
    ];
    const result = buildCommandPaletteRows({
      pages: candidates,
      prepared: prepareCommandPalettePages(candidates),
      query: "breast sensation",
      recentSlugs: ["wiki/rehab"],
    });
    expect(result.visibleEntries[0]).toEqual(candidates[0]);
  });

  test("does not discard substantial extra query terms or promote short titles", () => {
    const candidates = [
      { name: "Breast sensation after surgery", slug: "sources/sensation", path: "sources" },
      { name: "Breast sensation", slug: "sources/short", path: "sources" },
    ];
    const result = buildCommandPaletteRows({
      pages: candidates,
      prepared: prepareCommandPalettePages(candidates),
      query: "breast sensation after surgery radiation chemotherapy recovery",
      recentSlugs: [],
    });
    expect(result.visibleEntries).toEqual([]);
  });

  test("ranks complete titles before applying the result limit", () => {
    const target = { name: "Breast sensation after surgery", slug: "sources/sensation", path: "sources" };
    const candidates = [
      ...Array.from({ length: 60 }, (_, index) => ({
        name: "Breast sensation after surgery: what should patients expect?",
        slug: `sources/competitor-${index}`,
        path: "sources",
      })),
      target,
    ];
    const result = buildCommandPaletteRows({
      pages: candidates,
      prepared: prepareCommandPalettePages(candidates),
      query: "Breast sensation after surgery should",
      recentSlugs: ["sources/competitor-0"],
    });
    expect(result.visibleEntries[0]).toEqual(target);
    expect(result.visibleEntries).toHaveLength(50);
  });

  test("recency still breaks equal relevance ties", () => {
    const candidates = [
      { name: "Sensation after surgery", slug: "sources/first", path: "sources" },
      { name: "Sensation after surgery", slug: "sources/recent", path: "sources" },
    ];
    const result = buildCommandPaletteRows({
      pages: candidates,
      prepared: prepareCommandPalettePages(candidates),
      query: "sensation",
      recentSlugs: ["sources/recent"],
    });
    expect(result.visibleEntries[0]).toEqual(candidates[1]);
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

describe("recommended pages", () => {
  const entries: CommandPalettePageEntry[] = [
    { name: "tissue-sync-overview", slug: "notes/tissue-sync-overview", path: "notes" },
    { name: "tissue-sync-raw", slug: "notes/tissue-sync-raw", path: "notes" },
    { name: "tissue-sync-formatted", slug: "notes/tissue-sync-formatted", path: "notes" },
    { name: "tissue-and-data", title: "Tissue allocation plan", slug: "wiki/care/tissue-and-data", path: "wiki/care" },
    { name: "insurance", slug: "wiki/insurance", path: "wiki" },
  ];
  const build = (recommendedSlugs: string[]) => buildCommandPaletteRows({
    pages: entries, prepared: prepareCommandPalettePages(entries), query: "tissue", recentSlugs: [], recommendedSlugs,
  });

  test("lists recommendations above the remaining matches", () => {
    const rows = build(["wiki/care/tissue-and-data", "notes/tissue-sync-raw", "missing"]);
    // The raw sibling stands for its overview; an unknown slug is dropped; all matches are recommended, so no empty "Matches".
    expect(rows.visibleRows.map(row => row.type === "page" ? row.page.slug : `# ${row.label}`)).toEqual([
      "# Recommended", "wiki/care/tissue-and-data", "notes/tissue-sync-overview",
    ]);
    const partial = build(["wiki/care/tissue-and-data"]);
    expect(partial.visibleRows.map(row => row.type === "page" ? row.page.slug : `# ${row.label}`)).toEqual([
      "# Recommended", "wiki/care/tissue-and-data", "# Matches", "notes/tissue-sync-overview",
    ]);
    expect(rows.visibleEntries.slice(0, 2).map(page => page.slug)).toEqual(["wiki/care/tissue-and-data", "notes/tissue-sync-overview"]);
    expect(new Set(rows.visibleEntries.map(page => page.slug)).size).toBe(rows.visibleEntries.length);
    expect(rows.visibleRows.filter(row => row.type === "page").map(row => row.type === "page" && row.pageIndex)).toEqual(rows.visibleEntries.map((_, index) => index));
  });

  test("without recommendations the list is the plain ranked matches", () => {
    expect(build([]).visibleRows.some(row => row.type === "heading")).toBe(false);
  });
});

describe("smarter matching", () => {
  const rank = (entries: CommandPalettePageEntry[], query: string, recentSlugs: string[] = []) =>
    buildCommandPaletteRows({ pages: entries, prepared: prepareCommandPalettePages(entries), query, recentSlugs }).visibleEntries.map(page => page.slug);

  test("whole words in any order beat scattered letters, and a page may miss one of three words", () => {
    const entries: CommandPalettePageEntry[] = [
      { name: "single-port-robotic-nipple-sparing-mastectomy-landscape", slug: "sources/research/syntheses/landscape", path: "sources / research" },
      { name: "11-03-surgical-pathology", title: "November 3 surgical pathology — completion mastectomy and margins", slug: "sources/diagnostics/11-03-surgical-pathology", path: "sources / diagnostics" },
    ];
    expect(rank(entries, "mastectom path report")[0]).toBe("sources/diagnostics/11-03-surgical-pathology");
    expect(rank(entries, "pathology mastectomy")).toEqual(["sources/diagnostics/11-03-surgical-pathology"]);
  });

  test("plurals match their singular page, and an exact stemmed name is an exact match", () => {
    const entries: CommandPalettePageEntry[] = [
      { name: "services-agreement", slug: "wiki/logistics/tax/echo-redlines/services-agreement", path: "wiki / logistics / tax" },
      { name: "tax", slug: "wiki/logistics/tax", path: "wiki / logistics" },
    ];
    expect(rank(entries, "taxes")[0]).toBe("wiki/logistics/tax");
  });

  test("the host prior settles near-ties but not exact titles", () => {
    const entries: CommandPalettePageEntry[] = [
      { name: "clinical-trials", slug: "sources/research/zotero/clinical-trials", path: "sources / research", boost: -0.12 },
      { name: "clinical-trials", slug: "wiki/treatment/clinical-trials", path: "wiki / treatment", boost: 0.12 },
      { name: "ctdna-monitoring", slug: "wiki/care/ctdna-monitoring", path: "wiki / care", boost: 0.12 },
      { name: "ctdna", slug: "sources/research/ctdna", path: "sources / research", boost: -0.12 },
    ];
    expect(rank(entries, "clinical trials")[0]).toBe("wiki/treatment/clinical-trials");
    expect(rank(entries, "ctdna")[0]).toBe("sources/research/ctdna");
  });

  test("a single letter stays a fuzzy search", () => {
    const entries: CommandPalettePageEntry[] = [{ name: "alpha", slug: "a", path: "" }, { name: "beta", slug: "b", path: "" }];
    expect(rank(entries, "z")).toEqual([]);
  });
});
