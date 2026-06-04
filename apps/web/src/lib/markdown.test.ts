import { describe, expect, test } from "bun:test";
import {
  canonicalizePublishedSlug,
  groupFileTreeCollectionsDeep,
  isHiddenFileTreeAssetPath,
  isHiddenFileTreePath,
  sortTree,
  type FileNode,
} from "./markdown";

describe("isHiddenFileTreePath", () => {
  test("hides assets inside images directories", () => {
    expect(isHiddenFileTreePath("education/images/foo.png")).toBe(true);
    expect(isHiddenFileTreePath("images/hero-light.png")).toBe(true);
    expect(isHiddenFileTreePath("wiki/education/images")).toBe(true);
  });

  test("keeps non-image asset directories visible", () => {
    expect(isHiddenFileTreePath("education/sources/paper.pdf")).toBe(false);
    expect(isHiddenFileTreePath("education/image-analysis/notes.md")).toBe(false);
  });

  test("hides image file assets outside literal images directories", () => {
    expect(isHiddenFileTreeAssetPath("sources/paper-images/img-000.jpg")).toBe(true);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/figure.svg")).toBe(true);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/table.csv")).toBe(false);
  });
});

describe("canonicalizePublishedSlug", () => {
  test("maps legacy project-management view files into the views directory", () => {
    expect(canonicalizePublishedSlug("project-management/1-inbox")).toBe(
      "project-management/views/1-inbox",
    );
    expect(canonicalizePublishedSlug("project-management/2-urgent")).toBe(
      "project-management/views/2-urgent",
    );
    expect(canonicalizePublishedSlug("project-management/projects/clinical/foo")).toBe(
      "project-management/projects/clinical/foo",
    );
  });
});

describe("sortTree", () => {
  test("keeps index first and archived directories last", () => {
    const tree: FileNode[] = [
      { name: "zeta", slug: "wiki/diagnostics/zeta", type: "file" },
      { name: "archived", slug: "wiki/diagnostics/archived", type: "directory", children: [] },
      { name: "alpha", slug: "wiki/diagnostics/alpha", type: "file" },
      { name: "index", slug: "wiki/diagnostics/index", type: "file" },
    ];

    sortTree(tree);

    expect(tree.map((node) => node.name)).toEqual(["index", "alpha", "zeta", "archived"]);
  });

  test("sorts weekly updates by descending week number", () => {
    const tree: FileNode[] = [
      {
        name: "wiki",
        slug: "wiki",
        type: "directory",
        children: [
          {
            name: "updates",
            slug: "wiki/updates",
            type: "directory",
            children: [
              {
                name: "week-8-may-3-to-9",
                slug: "wiki/updates/week-8-may-3-to-9",
                type: "file",
              },
              {
                name: "index",
                slug: "wiki/updates/index",
                type: "file",
              },
              {
                name: "week-10-may-17-to-23",
                slug: "wiki/updates/week-10-may-17-to-23",
                type: "file",
              },
              {
                name: "week-9-may-10-to-16",
                slug: "wiki/updates/week-9-may-10-to-16",
                type: "file",
              },
            ],
          },
        ],
      },
    ];

    sortTree(tree);

    expect(tree[0]?.children?.[0]?.children?.map((node) => node.name)).toEqual([
      "week-10-may-17-to-23",
      "week-9-may-10-to-16",
      "week-8-may-3-to-9",
      "index",
    ]);
  });
});

describe("groupFileTreeCollectionsDeep", () => {
  test("groups meeting note raw, overview, and formatted siblings", () => {
    const tree: FileNode[] = [
      {
        name: "sources",
        slug: "sources",
        type: "directory",
        children: [
          {
            name: "meeting-notes",
            slug: "sources/meeting-notes",
            type: "directory",
            children: [
              {
                name: "05-13---echo-kernis-phm-tissue-sync-raw",
                slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-raw",
                type: "file",
              },
              {
                name: "05-13---echo-kernis-phm-tissue-sync-overview",
                slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview",
                type: "file",
              },
              {
                name: "05-13---echo-kernis-phm-tissue-sync-formatted",
                slug: "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-formatted",
                type: "file",
              },
              {
                name: "05-12---vahdat-consult-overview",
                slug: "sources/meeting-notes/05-12---vahdat-consult-overview",
                type: "file",
              },
            ],
          },
        ],
      },
    ];

    const grouped = groupFileTreeCollectionsDeep(tree);
    const meetingNotes = grouped[0]?.children?.[0];
    const meetingSet = meetingNotes?.children?.find(
      (node) =>
        node.type === "directory" &&
        node.slug === "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync__meeting-set",
    );

    expect(meetingSet).toMatchObject({
      name: "05-13---echo-kernis-phm-tissue-sync",
      type: "directory",
      badge: "Notes set",
    });
    expect(meetingSet?.children?.map((child) => [child.name, child.slug])).toEqual([
      ["Overview", "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview"],
      ["Formatted", "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-formatted"],
      ["Raw", "sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-raw"],
    ]);
    expect(meetingNotes?.children?.some((node) => node.slug.endsWith("vahdat-consult-overview"))).toBe(
      true,
    );
  });
});
