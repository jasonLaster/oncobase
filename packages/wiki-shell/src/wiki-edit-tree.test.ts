import { describe, expect, test } from "bun:test";
import { buildWikiEditTree, parseUnifiedDiffRows } from "./wiki-edit-tree.ts";

describe("wiki-edit-tree", () => {
  test("groups multi-page changes into a sorted nested folder tree", () => {
    const files = [
      {
        slug: "wiki/diagnostics/ctdna-vendors",
        title: "ctDNA Vendors",
        filePath: "wiki/diagnostics/ctdna-vendors.md",
        operation: "create" as const,
        sensitive: true,
        stats: { additions: 14, deletions: 0 },
      },
      {
        slug: "wiki/diagnostics/ctdna-mrd",
        title: "ctDNA / MRD",
        filePath: "wiki/diagnostics/ctdna-mrd.md",
        operation: "edit" as const,
        sensitive: false,
        stats: { additions: 9, deletions: 0 },
      },
      {
        slug: "about/glossary",
        title: "Glossary",
        filePath: "/about/glossary.md",
        operation: "edit" as const,
        sensitive: false,
        stats: { additions: 2, deletions: 1 },
      },
      {
        slug: "readme",
        title: "Readme",
        filePath: "",
        operation: "edit" as const,
        sensitive: false,
        stats: { additions: 1, deletions: 0 },
      },
    ];
    const tree = buildWikiEditTree(files);

    expect(tree.items.map((node) => node.label)).toEqual(["about", "wiki", "readme.md"]);
    expect(tree.folderPaths).toEqual(["about", "wiki", "wiki/diagnostics"]);
    const diagnostics = tree.items[1]?.children?.[0];
    expect(diagnostics?.value).toBe("wiki/diagnostics");
    expect(diagnostics?.children?.map((node) => node.value)).toEqual([
      "wiki/diagnostics/ctdna-mrd.md",
      "wiki/diagnostics/ctdna-vendors.md",
    ]);
    expect(tree.filesByPath.get("about/glossary.md")?.slug).toBe("about/glossary");
    expect(tree.filesByPath.get("readme.md")?.slug).toBe("readme");
  });

  test("parses unified diff hunks into line-numbered rows", () => {
    const rows = parseUnifiedDiffRows(
      [
        "@@ -10,3 +10,4 @@",
        " # Heading",
        "-Old line",
        "+New line A",
        "+New line B",
        " Tail",
      ].join("\n"),
    );

    expect(rows).toEqual([
      { kind: "hunk", text: "@@ -10,3 +10,4 @@" },
      { kind: "context", oldLine: 10, newLine: 10, text: "# Heading" },
      { kind: "del", oldLine: 11, newLine: null, text: "Old line" },
      { kind: "add", oldLine: null, newLine: 11, text: "New line A" },
      { kind: "add", oldLine: null, newLine: 12, text: "New line B" },
      { kind: "context", oldLine: 12, newLine: 13, text: "Tail" },
    ]);
  });
});
