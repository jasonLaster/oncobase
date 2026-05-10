import { describe, expect, test } from "bun:test";
import {
  buildCompactTreeFromManifest,
  expandCompactFileTree,
  makeWikiStoreId,
  parseWikiManifest,
  parseWikiPageBatch,
  parseWikiSessionIdentity,
  reconcilePageContent,
} from "./index";

describe("wiki content contracts", () => {
  test("expands compact file trees", () => {
    expect(expandCompactFileTree([["d", "wiki", [["f", "index"], ["p", "paper"]]]])).toEqual([
      {
        name: "wiki",
        slug: "wiki",
        type: "directory",
        children: [
          { name: "index", slug: "wiki/index", type: "file" },
          { name: "paper", slug: "wiki/paper.pdf", type: "pdf", pdfPath: "wiki/paper.pdf" },
        ],
      },
    ]);
  });

  test("builds compact trees from manifest entries", () => {
    expect(
      buildCompactTreeFromManifest(
        [{ slug: "index" }, { slug: "research/papers/index" }],
        [
          { kind: "pdf", path: "research/papers/trial.pdf" },
          { kind: "file", path: "images/scan.png" },
        ],
      ),
    ).toEqual([
      ["d", "images", [["f", "scan.png"]]],
      [
        "d",
        "research",
        [["d", "papers", [["f", "index"], ["p", "trial"]]]],
      ],
      ["f", "index"],
    ]);
  });

  test("parses manifest payloads", () => {
    const manifest = parseWikiManifest({
      siteSlug: "diana",
      manifestHash: "abc",
      generatedAt: "2026-05-09T12:00:00.000Z",
      scope: "public",
      compactTree: [["f", "index"]],
      pages: [
        {
          slug: "index",
          title: "Index",
          tags: [],
          description: null,
          contentHash: "hash",
          sensitive: false,
          size: 10,
        },
      ],
      assets: [{ kind: "pdf", path: "wiki/paper.pdf", contentHash: null, size: null }],
    });

    expect(manifest.pages[0]?.contentHash).toBe("hash");
  });

  test("rejects invalid manifest payloads before they reach LiveStore", () => {
    expect(() =>
      parseWikiManifest({
        siteSlug: "diana",
        manifestHash: "abc",
        generatedAt: "2026-05-09T12:00:00.000Z",
        scope: "public",
        compactTree: [["x", "bad"]],
        pages: [],
        assets: [],
      }),
    ).toThrow("manifest.compactTree");

    expect(() =>
      parseWikiManifest({
        siteSlug: "diana",
        manifestHash: "abc",
        generatedAt: "2026-05-09T12:00:00.000Z",
        scope: "public",
        compactTree: [],
        pages: [
          {
            slug: "index",
            title: "Index",
            tags: ["home"],
            description: null,
            contentHash: null,
            sensitive: false,
            size: "large",
          },
        ],
        assets: [],
      }),
    ).toThrow("page.size");
  });

  test("parses page batches and stable pagination cursors", () => {
    const batch = parseWikiPageBatch({
      siteSlug: "diana",
      generatedAt: "2026-05-09T12:00:00.000Z",
      scope: "public",
      pages: [
        {
          slug: "wiki/page",
          title: "Page",
          content: "# Page",
          tags: ["wiki"],
          contentHash: null,
          sensitive: false,
          size: 6,
        },
      ],
      isDone: false,
      continueCursor: "cursor-2",
    });

    expect(batch.continueCursor).toBe("cursor-2");
    expect(batch.pages[0]?.content).toBe("# Page");
  });

  test("reconciles content hashes", () => {
    expect(reconcilePageContent(null, { contentHash: "a" })).toEqual({ status: "missing" });
    expect(reconcilePageContent({ contentHash: "a" }, { contentHash: "a" })).toEqual({
      status: "fresh",
      contentHash: "a",
    });
    expect(reconcilePageContent({ contentHash: "a" }, { contentHash: "b" })).toEqual({
      status: "stale",
      localHash: "a",
      remoteHash: "b",
    });
    expect(reconcilePageContent({ contentHash: "a" }, null)).toEqual({
      status: "stale",
      localHash: "a",
      remoteHash: null,
    });
  });

  test("separates public and session store ids", () => {
    const publicId = makeWikiStoreId({
      siteSlug: "diana",
      scope: "public",
      origin: "https://example.test",
      cacheKey: "public-v1",
    });
    const sessionId = makeWikiStoreId({
      siteSlug: "diana",
      scope: "session",
      origin: "https://example.test",
      cacheKey: "session-user-1",
    });
    expect(publicId).not.toBe(sessionId);
    expect(sessionId).toContain("session-user-1");
    expect(
      makeWikiStoreId({
        siteSlug: "diana tn/bc",
        scope: "session",
        origin: "https://example.test/path",
        cacheKey: "user:1/private",
      }),
    ).toBe("wiki-vite-diana_tn_bc-session-https___example_test_path-user_1_private");
  });

  test("parses server-issued session cache identities", () => {
    const identity = parseWikiSessionIdentity({
      siteSlug: "diana",
      scope: "session",
      authenticated: true,
      cacheKey: "diana:session:user:v1",
      cacheVersion: "v1",
      userHash: "user",
    });

    expect(identity.authenticated).toBe(true);
    expect(identity.cacheKey).toContain("session");
  });
});
