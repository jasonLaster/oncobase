import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assetHistoryOrigin,
  carryPreviousAssets,
  HISTORY_FILE,
  isSafeAssetName,
  MAX_AGE_MS,
  MAX_BUILDS,
  parseHistory,
  retainedBuilds,
  type AssetHistory,
} from "./asset-history";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const dirs: string[] = [];

function dist(files: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "asset-history-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "assets"));
  for (const file of files) writeFileSync(path.join(dir, "assets", file), `current ${file}`);
  return dir;
}

/** A fake production origin: serves its history and the listed files only. */
function origin(history: unknown, files: Record<string, string>) {
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    const name = new URL(url).pathname.replace(/^\/assets\//, "");
    requested.push(name);
    if (name === HISTORY_FILE) return history === undefined ? new Response("Not found", { status: 404 }) : Response.json(history);
    return name in files ? new Response(files[name]) : new Response("Not found", { status: 404 });
  };
  return { fetcher, requested };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("carryPreviousAssets", () => {
  test("copies the live build's chunks that the new build no longer has", async () => {
    const distDir = dist(["index-new.js", "vendor-same.js"]);
    const live: AssetHistory = { version: 1, builds: [{ id: "A", builtAt: ago(1), files: ["index-old.js", "LiveStoreRoot-old.js", "vendor-same.js"] }] };
    const { fetcher, requested } = origin(live, { "index-old.js": "old index", "LiveStoreRoot-old.js": "old lazy" });
    const result = await carryPreviousAssets({ distDir, origin: "https://prod.example", buildId: "B", now: NOW, fetch: fetcher, log: () => {} });

    expect(result.carried).toEqual(["LiveStoreRoot-old.js", "index-old.js"]);
    // A shared, content-hashed file is never downloaded or overwritten.
    expect(requested).not.toContain("vendor-same.js");
    expect(readFileSync(path.join(distDir, "assets/vendor-same.js"), "utf8")).toBe("current vendor-same.js");
    expect(readFileSync(path.join(distDir, "assets/LiveStoreRoot-old.js"), "utf8")).toBe("old lazy");

    const written = JSON.parse(readFileSync(path.join(distDir, "assets", HISTORY_FILE), "utf8"));
    expect(written.builds.map((build: { id: string }) => build.id)).toEqual(["B", "A"]);
    expect(written.builds[0].files).toEqual(["index-new.js", "vendor-same.js"]);
  });

  test("a first deploy or unreachable origin carries nothing and still records history", async () => {
    for (const fetcher of [origin(undefined, {}).fetcher, async () => { throw new Error("offline"); }]) {
      const distDir = dist(["index-new.js"]);
      const result = await carryPreviousAssets({ distDir, origin: "https://prod.example", buildId: "B", now: NOW, fetch: fetcher, log: () => {} });
      expect(result.carried).toEqual([]);
      expect(result.history.builds).toEqual([{ id: "B", builtAt: new Date(NOW).toISOString(), files: ["index-new.js"] }]);
      expect(existsSync(path.join(distDir, "assets", HISTORY_FILE))).toBe(true);
    }
    const distDir = dist(["index-new.js"]);
    const result = await carryPreviousAssets({ distDir, origin: null, buildId: "B", now: NOW, log: () => {} });
    expect(result.history.builds).toHaveLength(1);
  });

  test("files that have gone missing are dropped from the history", async () => {
    const distDir = dist(["index-new.js"]);
    const live: AssetHistory = { version: 1, builds: [{ id: "A", builtAt: ago(1), files: ["kept.js", "gone.js"] }] };
    const { fetcher } = origin(live, { "kept.js": "k" });
    const result = await carryPreviousAssets({ distDir, origin: "https://prod.example", buildId: "B", now: NOW, fetch: fetcher, log: () => {} });
    expect(result.missing).toEqual(["gone.js"]);
    expect(result.history.builds[1].files).toEqual(["kept.js"]);
  });

  test("unsafe names in a fetched history are ignored", async () => {
    const distDir = dist([]);
    const live = { version: 1, builds: [{ id: "A", builtAt: ago(1), files: ["../../etc/passwd", "/abs.js", "ok.js", HISTORY_FILE] }] };
    const { fetcher, requested } = origin(live, { "ok.js": "ok" });
    const result = await carryPreviousAssets({ distDir, origin: "https://prod.example", buildId: "B", now: NOW, fetch: fetcher, log: () => {} });
    expect(result.carried).toEqual(["ok.js"]);
    expect(requested.filter(name => name !== HISTORY_FILE)).toEqual(["ok.js"]);
  });
});

describe("retention", () => {
  test("keeps at most the newest previous builds within the age limit", () => {
    const builds = Array.from({ length: MAX_BUILDS + 3 }, (_, index) => ({ id: `b${index}`, builtAt: ago(index), files: [] }));
    builds.push({ id: "stale", builtAt: new Date(NOW - MAX_AGE_MS - 1).toISOString(), files: [] });
    const kept = retainedBuilds({ version: 1, builds }, "b0", NOW);
    expect(kept.map(build => build.id)).toEqual(["b1", "b2", "b3", "b4"].slice(0, MAX_BUILDS - 1));
    expect(kept.map(build => build.id)).not.toContain("stale");
  });

  test("a redeploy of the same build does not count itself as previous", () => {
    expect(retainedBuilds({ version: 1, builds: [{ id: "B", builtAt: ago(0), files: ["x.js"] }] }, "B", NOW)).toEqual([]);
  });

  test("rejects malformed history", () => {
    expect(parseHistory(null)).toBeNull();
    expect(parseHistory({ version: 2, builds: [] })).toBeNull();
    expect(parseHistory({ version: 1, builds: [{ id: 1 }, { id: "a", builtAt: "nope", files: [] }] })?.builds).toEqual([]);
    expect(isSafeAssetName("pdf/viewer-abc.mjs")).toBe(true);
    for (const bad of ["..", "a/../b.js", "a//b.js", ".env", "a b.js", ""]) expect(isSafeAssetName(bad)).toBe(false);
  });

  test("origin comes from an override or the production domain", () => {
    expect(assetHistoryOrigin({ WIKI_ASSET_HISTORY_ORIGIN: "http://localhost:62131/" })).toBe("http://localhost:62131");
    expect(assetHistoryOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "diana-tnbc.com" })).toBe("https://diana-tnbc.com");
    expect(assetHistoryOrigin({})).toBeNull();
  });
});
