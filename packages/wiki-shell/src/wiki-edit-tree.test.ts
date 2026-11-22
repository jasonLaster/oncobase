import { describe, expect, test } from "bun:test";
import { buildWikiEditFileTree, parseUnifiedDiffRows } from "./wiki-edit-tree.ts";

describe("wiki-edit-tree", () => {
  test("groups multi-page changes into a sorted nested folder tree", () => {
    const tree = buildWikiEditFileTree([
      {
        slug: "wiki/diagnostics/ctdna-mrd",
        title: "ctDNA / MRD",
        filePath: "wiki/diagnostics/ctdna-mrd.md",
        operation: "edit",
        sensitive: false,
        stats: { additions: 9, deletions: 0 },
      },
      {
        slug: "wiki/diagnostics/ctdna-vendors",
        title: "ctDNA Vendors",
        filePath: "wiki/diagnostics/ctdna-vendors.md",
        operation: "create",
        sensitive: true,
        stats: { additions: 14, deletions: 0 },
      },
      {
        slug: "about/glossary",
        title: "Glossary",
        filePath: "about/glossary.md",
        operation: "edit",
        sensitive: false,
        stats: { additions: 2, deletions: 1 },
      },
    ]);

    expect(tree.map((node) => node.name)).toEqual(["about", "wiki"]);
    const wikiFolder = tree[1];
    expect(wikiFolder?.kind).toBe("folder");
    if (wikiFolder?.kind === "folder") {
      const diag = wikiFolder.children[0];
      expect(diag?.kind).toBe("folder");
      if (diag?.kind === "folder") {
        expect(diag.children.map((node) => node.name)).toEqual([
          "ctdna-mrd.md",
          "ctdna-vendors.md",
        ]);
      }
    }
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
