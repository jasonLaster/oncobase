import { describe, expect, test } from "bun:test";
import {
  WIKI_PREVIOUS_READER_CACHE_VERSION,
  WIKI_READER_CACHE_VERSION,
} from "@oncobase/wiki-content";
import {
  firstFrameSnapshotKey,
  persistFirstFrameSnapshot,
  readFirstFrameSnapshot,
  readFirstFrameSnapshotFallback,
  retireFirstFrameSnapshotsForPath,
  retirePreviousFirstFrameSnapshot,
} from "./first-frame-snapshot";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

const snapshot = {
  pathname: "/about",
  html:
    '<div data-test-id="wiki-sidebar">nav</div><article data-test-id="document-article"><h1>About</h1></article>',
};

describe("first-frame snapshots", () => {
  test("partitions valid snapshots by reader version, origin, and pathname", () => {
    const storage = memoryStorage();

    expect(
      persistFirstFrameSnapshot(storage, "https://wiki.example", snapshot, {
        validatedAt: 1,
      }),
    ).toBe(true);

    expect(
      readFirstFrameSnapshot(
        storage,
        "https://wiki.example",
        snapshot.pathname,
      ),
    ).toEqual(snapshot);
    expect(
      readFirstFrameSnapshot(storage, "https://other.example", snapshot.pathname),
    ).toBeNull();
    expect([...storage.values.keys()]).toEqual([
      firstFrameSnapshotKey("https://wiki.example"),
    ]);
  });

  test("ignores obsolete persisted titles while retaining valid shell markup", () => {
    const storage = memoryStorage();
    storage.setItem(
      firstFrameSnapshotKey("https://wiki.example"),
      JSON.stringify({ ...snapshot, title: "About - Diana Wiki" }),
    );

    expect(
      readFirstFrameSnapshot(
        storage,
        "https://wiki.example",
        snapshot.pathname,
      ),
    ).toEqual(snapshot);
  });

  test("rejects incomplete and oversized shell snapshots", () => {
    const storage = memoryStorage();
    expect(
      persistFirstFrameSnapshot(storage, "https://wiki.example", {
        ...snapshot,
        html: "x".repeat(2 * 1024 * 1024),
      }, { validatedAt: 1 }),
    ).toBe(false);

    storage.setItem(
      firstFrameSnapshotKey("https://wiki.example"),
      JSON.stringify({ ...snapshot, html: "<article>missing markers</article>" }),
    );
    expect(
      readFirstFrameSnapshot(
        storage,
        "https://wiki.example",
        snapshot.pathname,
      ),
    ).toBeNull();
  });

  test("uses only a validated N-1 snapshot and prefers current content", () => {
    const storage = memoryStorage();
    expect(
      persistFirstFrameSnapshot(
        storage,
        "https://wiki.example",
        { ...snapshot, html: snapshot.html.replace("About", "Previous") },
        {
          readerCacheVersion: WIKI_PREVIOUS_READER_CACHE_VERSION,
          validatedAt: 1,
        },
      ),
    ).toBe(true);

    expect(
      readFirstFrameSnapshotFallback(
        storage,
        "https://wiki.example",
        snapshot.pathname,
      ),
    ).toEqual({
      ...snapshot,
      html: snapshot.html.replace("About", "Previous"),
      readerCacheVersion: WIKI_PREVIOUS_READER_CACHE_VERSION,
    });

    expect(
      persistFirstFrameSnapshot(storage, "https://wiki.example", snapshot, {
        validatedAt: 2,
      }),
    ).toBe(true);
    expect(
      readFirstFrameSnapshotFallback(
        storage,
        "https://wiki.example",
        snapshot.pathname,
      ),
    ).toEqual({
      ...snapshot,
      readerCacheVersion: WIKI_READER_CACHE_VERSION,
    });
  });

  test("rejects unvalidated N-1 markup and retires only its snapshot key", () => {
    const storage = memoryStorage();
    const previousKey = firstFrameSnapshotKey(
      "https://wiki.example",
      WIKI_PREVIOUS_READER_CACHE_VERSION,
    );
    storage.setItem(previousKey, JSON.stringify(snapshot));
    storage.setItem(
      firstFrameSnapshotKey("https://wiki.example"),
      JSON.stringify(snapshot),
    );

    expect(
      readFirstFrameSnapshotFallback(
        storage,
        "https://wiki.example",
        snapshot.pathname,
      )?.readerCacheVersion,
    ).toBe(WIKI_READER_CACHE_VERSION);

    retirePreviousFirstFrameSnapshot(storage, "https://wiki.example");
    expect(storage.values.has(previousKey)).toBe(false);
    expect(
      storage.values.has(firstFrameSnapshotKey("https://wiki.example")),
    ).toBe(true);
  });

  test("retires current and N-1 snapshots only when they match the unavailable route", () => {
    const storage = memoryStorage();
    const currentKey = firstFrameSnapshotKey("https://wiki.example");
    const previousKey = firstFrameSnapshotKey(
      "https://wiki.example",
      WIKI_PREVIOUS_READER_CACHE_VERSION,
    );
    storage.setItem(currentKey, JSON.stringify(snapshot));
    storage.setItem(
      previousKey,
      JSON.stringify({ ...snapshot, pathname: "/wiki/other" }),
    );

    retireFirstFrameSnapshotsForPath(
      storage,
      "https://wiki.example",
      snapshot.pathname,
    );

    expect(storage.values.has(currentKey)).toBe(false);
    expect(storage.values.has(previousKey)).toBe(true);
  });
});
