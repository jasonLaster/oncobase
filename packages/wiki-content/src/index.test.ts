import { describe, expect, test } from "bun:test";
import {
  buildCompactTreeFromManifest,
  createWikiContentClient,
  expandCompactFileTree,
  isHiddenFileTreeAssetPath,
  isHiddenFileTreePath,
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
      [
        "d",
        "research",
        [["d", "papers", [["f", "index"], ["p", "trial"]]]],
      ],
      ["f", "index"],
    ]);
  });

  test("hides image asset directories from the navigation tree only", () => {
    expect(isHiddenFileTreePath("images/scan.png")).toBe(true);
    expect(isHiddenFileTreePath("wiki/media/images/scan.png")).toBe(true);
    expect(isHiddenFileTreePath("wiki/image-analysis/notes")).toBe(false);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/img-000.jpg")).toBe(true);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/diagram.svg")).toBe(true);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/table.csv")).toBe(false);
    expect(
      buildCompactTreeFromManifest(
        [{ slug: "wiki/image-analysis/notes" }, { slug: "wiki/education/images/index" }],
        [
          { kind: "file", path: "wiki/media/images/scan.png" },
          { kind: "file", path: "sources/paper-images/img-000.jpg" },
          { kind: "pdf", path: "sources/images/pathology-slide.pdf" },
          { kind: "pdf", path: "sources/institutions/stanford/telli.pdf" },
        ],
      ),
    ).toEqual([
      ["d", "sources", [["d", "institutions", [["d", "stanford", [["p", "telli"]]]]]]],
      ["d", "wiki", [["d", "image-analysis", [["f", "notes"]]]]],
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
    ).toBe("wiki-vite-reader-v2-diana_tn_bc-session-https___example_test_path-user_1_private");
  });

  test("includes the reader cache version in store ids", () => {
    const currentId = makeWikiStoreId({
      siteSlug: "diana",
      scope: "public",
      origin: "https://example.test",
      cacheKey: "public-v1",
    });
    const nextId = makeWikiStoreId({
      siteSlug: "diana",
      scope: "public",
      origin: "https://example.test",
      cacheKey: "public-v1",
      readerCacheVersion: "reader:v2",
    });

    expect(currentId).toContain("reader-v2");
    expect(nextId).toBe("wiki-vite-reader_v2-diana-public-https___example_test-public-v1");
    expect(nextId).not.toBe(currentId);
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

  test("client helpers can include credentials for preview API origins", async () => {
    let requestInit: RequestInit | undefined;
    const client = createWikiContentClient({
      baseUrl: "https://wiki.example",
      credentials: "include",
      fetch: (async (_url, init) => {
        requestInit = init;
        return Response.json({
          siteSlug: "diana",
          scope: "public",
          authenticated: false,
          cacheKey: "public",
          cacheVersion: "v1",
          userHash: null,
        });
      }) as typeof fetch,
    });

    await client.fetchSessionIdentity();

    expect(requestInit?.credentials).toBe("include");
    expect(requestInit?.cache).toBe("no-cache");
  });

  test("client helpers allow cache policy overrides", async () => {
    let requestInit: RequestInit | undefined;
    const client = createWikiContentClient({
      cache: "reload",
      fetch: (async (_url, init) => {
        requestInit = init;
        return Response.json({
          siteSlug: "diana",
          manifestHash: "hash",
          generatedAt: "2026-05-10T00:00:00.000Z",
          scope: "public",
          compactTree: [],
          pages: [],
          assets: [],
        });
      }) as typeof fetch,
    });

    await client.fetchManifest();

    expect(requestInit?.cache).toBe("reload");
  });

  test("client helpers time out stalled wiki requests", async () => {
    const client = createWikiContentClient({
      requestTimeoutMs: 1,
      fetch: (async (_url, init) => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
        throw new Error("unreachable");
      }) as typeof fetch,
    });

    await expect(client.fetchManifest()).rejects.toThrow("timed out");
  });
});
