import { describe, expect, test } from "bun:test";
import { visibleTreeRows } from "@oncobase/ui/tree";
import { collectActiveAncestors, expandedTreeValues, treeNodeKey, wikiTreeIndex, type WikiNavigationNode } from "./navigation";

const file = (slug: string): WikiNavigationNode => ({ name: slug, slug, type: "file" });
const directory = (slug: string, children: WikiNavigationNode[]): WikiNavigationNode => ({ name: slug, slug, type: "directory", children });

function visible(tree: WikiNavigationNode[], expandedSlugs: string[]) {
  const index = wikiTreeIndex(tree);
  return visibleTreeRows(index.items, expandedTreeValues(index, expandedSlugs)).map(row => ({ ...index.entries.get(row.item.value)!, value: row.item.value }));
}

describe("navigation projections", () => {
  test("cached ancestors retain matching shortcuts in multiple roots", () => {
    const tree = [directory("first", [directory("nested", [file("shared")]), directory("later", [file("shared")])]), directory("second", [file("shared")])];
    expect([...collectActiveAncestors(tree, "shared")]).toEqual(["first", "nested", "second"]);
    const ancestors = collectActiveAncestors(tree, "shared");
    ancestors.clear();
    expect([...collectActiveAncestors(tree, "shared")]).toEqual(["first", "nested", "second"]);
    expect([...collectActiveAncestors(tree, "missing")]).toEqual([]);
  });

  test("visible rows keep order, depth, root spacing and collapse", () => {
    const tree = [file("index"), directory("folder", [file("a"), directory("nested", [file("b")])])];
    expect(visible(tree, ["folder", "nested"]).map(({ node, depth, gap }) => [node.slug, depth, gap]))
      .toEqual([["index", 0, 4], ["folder", 0, 4], ["a", 1, 2], ["nested", 1, 0], ["b", 2, 2]]);
    expect(visible(tree, ["nested"]).map(row => row.node.slug)).toEqual(["index", "folder"]);
  });

  test("labels are formatted for typeahead, and PDF identities remain distinct", () => {
    const index = wikiTreeIndex([directory("my-folder", [{ ...file("a"), type: "pdf", pdfPath: "a.pdf" }])], name => name.toUpperCase());
    expect(index.items[0]).toMatchObject({ label: "MY-FOLDER", children: [{ label: "A.pdf" }] });
    expect(treeNodeKey({ ...file("a"), type: "pdf", pdfPath: "one.pdf" })).not.toBe(treeNodeKey({ ...file("a"), type: "pdf", pdfPath: "two.pdf" }));
  });

  test("shortcuts have unique occurrence values that survive other branches collapsing", () => {
    const tree = [directory("first", [file("shared")]), directory("second", [file("shared")])];
    const rows = visible(tree, ["first", "second"]);
    expect(new Set(rows.map(row => row.value)).size).toBe(rows.length);
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
    const collapsed = visible(tree, ["second"]);
    expect(collapsed.at(-1)?.value).toBe(rows.at(-1)?.value);
    // The first occurrence takes `current`.
    expect(wikiTreeIndex(tree).fileValues.get("shared")).toBe(rows[1].value);
  });

  test("a directory slug in two roots opens both occurrences", () => {
    const tree = [directory("a", [directory("shared", [file("x")])]), directory("shared", [file("y")])];
    const index = wikiTreeIndex(tree);
    expect(expandedTreeValues(index, ["shared", "shared"])).toHaveLength(2);
  });
});
