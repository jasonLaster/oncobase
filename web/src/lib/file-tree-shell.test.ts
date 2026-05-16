import { describe, expect, test } from "bun:test";
import type { FileNode } from "./file-tree-compact";
import {
  fileTreeHasTruncatedNodes,
  pruneFileTreeForShell,
  shouldLoadFullFileTree,
} from "./file-tree-shell";

const fullTree: FileNode[] = [
  {
    name: "sources",
    slug: "sources",
    type: "directory",
    children: [
      {
        name: "institutions",
        slug: "sources/people/providers",
        type: "directory",
        children: [
          {
            name: "stanford",
            slug: "sources/people/providers/stanford",
            type: "directory",
            children: [
              {
                name: "telli",
                slug: "sources/people/providers/stanford/telli",
                type: "directory",
                children: [
                  {
                    name: "telli-2016-hrd-platinum-tnbc",
                    slug: "sources/people/providers/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf",
                    type: "pdf",
                    pdfPath: "sources/people/providers/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "wiki",
    slug: "wiki",
    type: "directory",
    children: [
      {
        name: "education",
        slug: "wiki/education",
        type: "directory",
        children: [
          {
            name: "oncology",
            slug: "wiki/education/oncology",
            type: "file",
          },
        ],
      },
      {
        name: "updates",
        slug: "wiki/updates",
        type: "directory",
        children: [
          {
            name: "week-6-april-19-to-25",
            slug: "wiki/updates/week-6-april-19-to-25",
            type: "file",
          },
        ],
      },
    ],
  },
];

describe("pruneFileTreeForShell", () => {
  test("keeps top-level and second-level nodes complete", () => {
    const shell = pruneFileTreeForShell(fullTree, { maxDepth: 2 });

    expect(shell.map((node) => node.slug)).toEqual(["sources", "wiki"]);
    expect(shell[0].children?.map((node) => node.slug)).toEqual([
      "sources/people/providers",
    ]);
    expect(shell[1].children?.map((node) => node.slug)).toEqual([
      "wiki/education",
      "wiki/updates",
    ]);
  });

  test("marks deeper directories as truncated and omits their children", () => {
    const shell = pruneFileTreeForShell(fullTree, { maxDepth: 2 });
    const institutions = shell[0].children?.[0];
    const education = shell[1].children?.[0];

    expect(institutions).toMatchObject({
      slug: "sources/people/providers",
      truncated: true,
      children: [],
    });
    expect(education).toMatchObject({
      slug: "wiki/education",
      truncated: true,
      children: [],
    });
    expect(fileTreeHasTruncatedNodes(shell)).toBe(true);
  });

  test("does not keep deep source paths in the shell tree", () => {
    const shell = pruneFileTreeForShell(fullTree, { maxDepth: 2 });
    const json = JSON.stringify(shell);

    expect(json).not.toContain("sources/people/providers/stanford");
    expect(json).not.toContain("sources/people/providers/stanford/telli");
    expect(json).not.toContain("telli-2016-hrd-platinum-tnbc.pdf");
  });

  test("detects complete non-truncated trees without refetching", () => {
    const completeTree: FileNode[] = [
      { name: "about", slug: "about", type: "directory", children: [] },
    ];

    expect(fileTreeHasTruncatedNodes(completeTree)).toBe(false);
    expect(shouldLoadFullFileTree(completeTree)).toBe(false);
  });

  test("requests the full tree when the shell is empty or truncated", () => {
    const shell = pruneFileTreeForShell(fullTree, { maxDepth: 2 });

    expect(shouldLoadFullFileTree([])).toBe(true);
    expect(shouldLoadFullFileTree(shell)).toBe(true);
  });
});
