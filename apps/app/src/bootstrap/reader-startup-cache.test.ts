import { describe, expect, test } from "bun:test";
import { buildCompactTreeFromManifest, makePublicWikiSessionIdentity, WIKI_MANIFEST_SCHEMA_VERSION, WIKI_READER_CACHE_VERSION, WIKI_SESSION_CACHE_VERSION } from "@oncobase/wiki-content";
import { parseStartupSnapshot, sameStartupIdentity, startupInitialData, STARTUP_CACHE_MAX_AGE, type StartupSnapshot } from "./reader-startup-cache";
import { readerShellHint } from "./reader-shell-hint";

const now = Date.now();
const partition = "https://wiki.example|https://wiki.example";
function snapshot(): StartupSnapshot {
  const page = { slug: "index", title: "Home", content: "# Home\n\nCached body", contentHash: "h1", size: 22, tags: [], sensitive: false };
  const pages = [{ ...page, description: null }];
  return { version: 1, partition, readerVersion: WIKI_READER_CACHE_VERSION, identity: makePublicWikiSessionIdentity("diana"), validatedAt: now,
    manifest: { schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION, siteSlug: "diana", scope: "public", generatedAt: "", manifestHash: "m1", pages, assets: [], compactTree: buildCompactTreeFromManifest(pages, []) },
    bodies: [{ pathname: "/", page, fetchedAt: now }] };
}
const parse = (value: unknown, at = now) => parseStartupSnapshot(JSON.stringify(value), partition, at);

describe("remembered reader access and content", () => {
  test("restores the page and navigation; can render an indexed page's shell without its body", () => {
    const value = parse(snapshot())!;
    expect(startupInitialData(value, "/")?.page.content).toContain("Cached body");
    expect(startupInitialData(value, "/")?.tree.length).toBeGreaterThan(0);
    expect(startupInitialData({ ...value, bodies: [] }, "/")?.page.content).toBe("");
    expect(startupInitialData(value, "/absent")).toBeNull();
  });
  test("is partitioned by origin, API, reader version, scope and complete identity", () => {
    const value = snapshot();
    expect(parse({ ...value, partition: "https://other.example|https://wiki.example" })).toBeNull();
    expect(parse({ ...value, readerVersion: "old" })).toBeNull();
    expect(parse({ ...value, identity: { ...value.identity, cacheVersion: "old" } })).toBeNull();
    expect(parse({ ...value, manifest: { ...value.manifest, scope: "session" } })).toBeNull();
    expect(sameStartupIdentity(value.identity, { ...value.identity, cacheKey: "new-permissions" })).toBe(false);
  });
  test("remembers private content only for an authenticated account snapshot", () => {
    const value = snapshot();
    value.bodies[0].page.sensitive = true;
    expect(parse(value)).toBeNull();
    value.identity = { ...value.identity, authenticated: true, scope: "session", userHash: "user-A", cacheKey: "account-A", cacheVersion: WIKI_SESSION_CACHE_VERSION };
    value.manifest.scope = "session";
    expect(parse(value)?.identity.userHash).toBe("user-A");
    expect(parse({ ...value, identity: { ...value.identity, userHash: null } })).toBeNull();
    expect(sameStartupIdentity(value.identity, { ...value.identity, userHash: "user-B" })).toBe(false);
  });
  test("rejects expired, future, unindexed, malformed and oversized snapshots", () => {
    const value = snapshot();
    expect(parse(value, now + STARTUP_CACHE_MAX_AGE + 1)).toBeNull();
    expect(parse(value, now - 1)).toBeNull();
    expect(parse({ ...value, manifest: { ...value.manifest, pages: [] } })).toBeNull();
    expect(parse({ ...value, bodies: [{ ...value.bodies[0], pathname: "/wrong" }] })).toBeNull();
    expect(parseStartupSnapshot("not json", partition)).toBeNull();
    expect(parseStartupSnapshot(" ".repeat(2 * 1024 * 1024 + 1), partition)).toBeNull();
  });
  test("HTML hint is exact-route, bounded and explicitly bypassable", () => {
    const cookie = `unrelated=x; wiki_reader_shell=${encodeURIComponent(JSON.stringify(["/", "/wiki/page"]))}`;
    expect(readerShellHint(cookie, new URL("https://wiki.example/"))).toBe(true);
    expect(readerShellHint(cookie, new URL("https://wiki.example/other"))).toBe(false);
    expect(readerShellHint(cookie, new URL("https://wiki.example/?readerCache=0"))).toBe(false);
    expect(readerShellHint("wiki_reader_shell=bad", new URL("https://wiki.example/"))).toBe(false);
  });
});
