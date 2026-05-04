import { describe, expect, test } from "bun:test";
import {
  compactFileTree,
  expandCompactFileTree,
  type FileNode,
} from "./file-tree-compact";

describe("compact file tree", () => {
  test("round-trips file trees while deriving ordinary child slugs", () => {
    const tree: FileNode[] = [
      {
        name: "sources",
        slug: "sources",
        type: "directory",
        children: [
          {
            name: "institutions",
            slug: "sources/institutions",
            type: "directory",
            children: [
              {
                name: "stanford",
                slug: "sources/institutions/stanford",
                type: "directory",
                children: [
                  {
                    name: "telli",
                    slug: "sources/institutions/stanford/telli",
                    type: "directory",
                    children: [
                      {
                        name: "telli-2016-hrd-platinum-tnbc",
                        slug: "sources/institutions/stanford/telli/telli-2016-hrd-platinum-tnbc__paper-set",
                        type: "directory",
                        badge: "PDF set",
                        children: [
                          {
                            name: "Markdown",
                            slug: "sources/institutions/stanford/telli/telli-2016-hrd-platinum-tnbc",
                            type: "file",
                          },
                          {
                            name: "PDF",
                            slug: "sources/institutions/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf",
                            type: "pdf",
                            pdfPath: "sources/institutions/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const compact = compactFileTree(tree);

    expect(JSON.stringify(compact)).not.toContain(
      "sources/institutions/stanford/telli/telli-2016-hrd-platinum-tnbc__paper-set",
    );
    expect(JSON.stringify(compact)).toContain(
      "sources/institutions/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf",
    );
    expect(expandCompactFileTree(compact)).toEqual(tree);
  });
});
