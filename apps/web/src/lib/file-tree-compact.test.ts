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
                        slug: "sources/people/providers/stanford/telli/telli-2016-hrd-platinum-tnbc__paper-set",
                        type: "directory",
                        badge: "PDF set",
                        children: [
                          {
                            name: "Markdown",
                            slug: "sources/people/providers/stanford/telli/telli-2016-hrd-platinum-tnbc",
                            type: "file",
                          },
                          {
                            name: "PDF",
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
        ],
      },
    ];

    const compact = compactFileTree(tree);
    const compactJson = JSON.stringify(compact);

    expect(compactJson).not.toContain(
      "sources/people/providers/stanford/telli/telli-2016-hrd-platinum-tnbc__paper-set",
    );
    expect(compactJson).not.toContain(
      "sources/people/providers/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf",
    );
    expect(compactJson).toContain("../telli-2016-hrd-platinum-tnbc");
    expect(compactJson).toContain("../telli-2016-hrd-platinum-tnbc.pdf");
    expect(expandCompactFileTree(compact)).toEqual(tree);
  });
});
