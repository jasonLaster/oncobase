import { describe, expect, test } from "bun:test";
import { collectActiveAncestors, flattenVisibleWikiTree, treeNodeKey, type WikiNavigationNode } from "./navigation";

const file = (slug: string): WikiNavigationNode => ({ name: slug, slug, type: "file" });
const directory = (slug: string, children: WikiNavigationNode[]): WikiNavigationNode => ({ name: slug, slug, type: "directory", children });

describe("navigation projections", () => {
  test("cached ancestors retain matching shortcuts in multiple roots", () => {
    const tree = [directory("first", [directory("nested", [file("shared")]), directory("later", [file("shared")])]), directory("second", [file("shared")])];
    expect([...collectActiveAncestors(tree, "shared")]).toEqual(["first", "nested", "second"]);
    const ancestors = collectActiveAncestors(tree, "shared");
    ancestors.clear();
    expect([...collectActiveAncestors(tree, "shared")]).toEqual(["first", "nested", "second"]);
    expect([...collectActiveAncestors(tree, "missing")]).toEqual([]);
  });

  test("flattening preserves order, depth, root spacing and explicit collapse", () => {
    const tree = [file("index"), directory("folder", [file("a"), directory("nested", [file("b")])])];
    const props = { tree, activeAncestorSlugs: new Set(["folder", "nested"]), expandedSlugs: new Map<string, boolean>() };
    expect(flattenVisibleWikiTree(props).map(({ node, depth, gap }) => [node.slug, depth, gap]))
      .toEqual([["index", 0, 4], ["folder", 0, 4], ["a", 1, 2], ["nested", 1, 0], ["b", 2, 2]]);
    expect(flattenVisibleWikiTree({ ...props, expandedSlugs: new Map([["folder", false]]) }).map(row => row.node.slug)).toEqual(["index", "folder"]);
  });

  test("caller defaults and PDF identities remain distinct", () => {
    const tree = [directory("folder", [file("a")])];
    expect(flattenVisibleWikiTree({ tree, activeAncestorSlugs: new Set(), expandedSlugs: new Map(), defaultDirectoryOpen: () => false })).toHaveLength(1);
    expect(treeNodeKey({ ...file("a"), type: "pdf", pdfPath: "one.pdf" })).not.toBe(treeNodeKey({ ...file("a"), type: "pdf", pdfPath: "two.pdf" }));
  });

  test("flattened shortcuts have unique occurrence keys that survive other branches collapsing", () => {
    const tree = [directory("first", [file("shared")]), directory("second", [file("shared")])];
    const props = { tree, activeAncestorSlugs: new Set<string>(), expandedSlugs: new Map<string, boolean>() };
    const rows = flattenVisibleWikiTree(props);
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
    const collapsed = flattenVisibleWikiTree({ ...props, expandedSlugs: new Map([["first", false]]) });
    expect(collapsed.at(-1)?.key).toBe(rows.at(-1)?.key);
  });
});
