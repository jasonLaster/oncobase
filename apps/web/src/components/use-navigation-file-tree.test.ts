import { describe, expect, test } from "bun:test";
import type { FileNode } from "@/lib/markdown";
import type { CompactFileNode } from "@/lib/file-tree-compact";
import { resolveNavigationFileTree } from "./use-navigation-file-tree";

const shellTree: FileNode[] = [
  {
    name: "wiki",
    slug: "wiki",
    type: "directory",
    truncated: true,
    children: [],
  },
];

const compactTree: CompactFileNode[] = [
  ["d", "wiki", [["f", "index"], ["f", "treatment"]]],
];

describe("resolveNavigationFileTree", () => {
  test("renders the initial shell tree before the compact tree request resolves", () => {
    const result = resolveNavigationFileTree({
      enabled: true,
      initialTree: shellTree,
    });

    expect(result.ready).toBe(true);
    expect(result.tree).toEqual(shellTree);
  });

  test("uses compact public tree data when it is available", () => {
    const result = resolveNavigationFileTree({
      enabled: true,
      initialTree: shellTree,
      publicCompactTree: compactTree,
    });

    expect(result.ready).toBe(true);
    expect(result.tree).toEqual([
      {
        name: "wiki",
        slug: "wiki",
        type: "directory",
        children: [
          { name: "index", slug: "wiki/index", type: "file" },
          { name: "treatment", slug: "wiki/treatment", type: "file" },
        ],
      },
    ]);
  });

  test("keeps navigation disabled for routes that do not use the file tree", () => {
    const result = resolveNavigationFileTree({
      enabled: false,
      initialTree: shellTree,
      publicCompactTree: compactTree,
    });

    expect(result.ready).toBe(false);
  });
});
