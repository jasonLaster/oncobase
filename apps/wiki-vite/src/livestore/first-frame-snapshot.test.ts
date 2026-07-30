import { describe, expect, test } from "bun:test";
import {
  firstFrameSnapshotKey,
  persistFirstFrameSnapshot,
  readFirstFrameSnapshot,
} from "./first-frame-snapshot";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

const snapshot = {
  pathname: "/about",
  title: "About - Diana Wiki",
  html:
    '<div data-test-id="wiki-sidebar">nav</div><article data-test-id="document-article"><h1>About</h1></article>',
};

describe("first-frame snapshots", () => {
  test("partitions valid snapshots by reader version, origin, and pathname", () => {
    const storage = memoryStorage();

    expect(
      persistFirstFrameSnapshot(storage, "https://wiki.example", snapshot),
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

  test("rejects incomplete and oversized shell snapshots", () => {
    const storage = memoryStorage();
    expect(
      persistFirstFrameSnapshot(storage, "https://wiki.example", {
        ...snapshot,
        html: "x".repeat(2 * 1024 * 1024),
      }),
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
});
