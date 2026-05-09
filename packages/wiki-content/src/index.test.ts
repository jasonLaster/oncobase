import { describe, expect, test } from "bun:test";
import {
  buildCompactTreeFromManifest,
  expandCompactFileTree,
  makeWikiStoreId,
  parseWikiManifest,
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
