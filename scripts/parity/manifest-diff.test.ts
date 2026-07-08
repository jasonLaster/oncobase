import { describe, expect, test } from "bun:test";
import {
  diffManifests,
  renderManifestDiffMarkdown,
  type WikiManifest,
} from "./manifest-diff";

function manifest(overrides: Partial<WikiManifest> = {}): WikiManifest {
  return {
    manifestHash: "same",
    scope: "public",
    compactTree: [["f", "index"]],
    pages: [
      {
        slug: "index",
        contentHash: "hash-index",
        size: 10,
      },
    ],
    assets: [
      {
        kind: "pdf",
        path: "sources/paper.pdf",
        contentHash: "hash-pdf",
        size: 20,
      },
    ],
    ...overrides,
  };
}

describe("manifest diff", () => {
  test("treats matching manifest hashes and records as equal", () => {
    const diff = diffManifests(manifest(), manifest());

    expect(diff.manifestHashEqual).toBe(true);
    expect(diff.compactTreeEqual).toBe(true);
    expect(diff.missingPages).toEqual([]);
    expect(diff.extraPages).toEqual([]);
    expect(diff.changedPages).toEqual([]);
    expect(diff.changedAssets).toEqual([]);
  });

  test("reports page set and page hash drift", () => {
    const diff = diffManifests(
      manifest({
        manifestHash: "left",
        pages: [
          { slug: "index", contentHash: "hash-index", size: 10 },
          { slug: "legacy-only", contentHash: "hash-legacy", size: 11 },
          { slug: "changed", contentHash: "left-hash", size: 12 },
        ],
      }),
      manifest({
        manifestHash: "right",
        pages: [
          { slug: "index", contentHash: "hash-index", size: 10 },
          { slug: "vite-only", contentHash: "hash-vite", size: 13 },
          { slug: "changed", contentHash: "right-hash", size: 14 },
        ],
      }),
    );

    expect(diff.manifestHashEqual).toBe(false);
    expect(diff.missingPages).toEqual(["legacy-only"]);
    expect(diff.extraPages).toEqual(["vite-only"]);
    expect(diff.changedPages).toEqual([
      {
        slug: "changed",
        leftContentHash: "left-hash",
        rightContentHash: "right-hash",
        leftSize: 12,
        rightSize: 14,
      },
    ]);
  });

  test("reports asset drift and compact tree drift", () => {
    const diff = diffManifests(
      manifest({
        compactTree: [["f", "index"]],
        assets: [
          { kind: "pdf", path: "same.pdf", contentHash: "a", size: 1 },
          { kind: "file", path: "left.png", contentHash: "left", size: 2 },
          { kind: "file", path: "changed.png", contentHash: "left", size: 3 },
        ],
      }),
      manifest({
        compactTree: [["f", "home"]],
        assets: [
          { kind: "pdf", path: "same.pdf", contentHash: "a", size: 1 },
          { kind: "file", path: "right.png", contentHash: "right", size: 4 },
          { kind: "file", path: "changed.png", contentHash: "right", size: 5 },
        ],
      }),
    );

    expect(diff.compactTreeEqual).toBe(false);
    expect(diff.missingAssets).toEqual(["file:left.png"]);
    expect(diff.extraAssets).toEqual(["file:right.png"]);
    expect(diff.changedAssets).toEqual([
      {
        key: "file:changed.png",
        leftContentHash: "left",
        rightContentHash: "right",
        leftSize: 3,
        rightSize: 5,
      },
    ]);
  });

  test("renders a markdown summary", () => {
    const left = manifest({ manifestHash: "left" });
    const right = manifest({ manifestHash: "right" });
    const markdown = renderManifestDiffMarkdown(
      { label: "legacy", origin: "https://diana-tnbc.com", manifest: left },
      { label: "vite", origin: "https://vite.example", manifest: right },
      diffManifests(left, right),
    );

    expect(markdown).toContain("# Wiki Manifest Parity Report");
    expect(markdown).toContain("Manifest hash match: **no**");
    expect(markdown).toContain("https://vite.example");
  });
});
