import { describe, expect, test } from "bun:test";
import { makePublicWikiSessionIdentity } from "@oncobase/wiki-content";
import type { PageContentRow, SiteStateRow } from "../types";
import {
  isCurrentReaderHydrated,
  previousReaderStoreDirectoryPrefix,
  retirePreviousReaderStore,
} from "./cache-retirement";

const identity = makePublicWikiSessionIdentity("diana");
const state: SiteStateRow = {
  siteSlug: "diana",
  scope: "public",
  manifestHash: "manifest",
  generatedAt: "2026-07-30T00:00:00.000Z",
  lastSyncAt: 1,
  lastValidatedAt: 1,
  manifestSize: 10,
  schemaVersion: 4,
};
const page: PageContentRow = {
  slug: "index",
  title: "Index",
  content: "# Index",
  tagsJson: "[]",
  contentHash: "page",
  expectedContentHash: "page",
  sensitive: false,
  size: 7,
  fetchedAt: 1,
  missingAt: null,
  staleAt: null,
  deletedAt: null,
  contentStatus: "fresh",
};

describe("reader cache retirement", () => {
  test("requires a validated current projection and a fresh current page", () => {
    expect(isCurrentReaderHydrated({ identity, state, page, scope: "public" })).toBe(true);
    expect(
      isCurrentReaderHydrated({
        identity,
        state: { ...state, lastValidatedAt: 0 },
        page,
        scope: "public",
      }),
    ).toBe(false);
    expect(
      isCurrentReaderHydrated({
        identity,
        state,
        page: { ...page, contentStatus: "stale" },
        scope: "public",
      }),
    ).toBe(false);
  });

  test("removes only the matching reader-v3 namespace", async () => {
    const prefix = previousReaderStoreDirectoryPrefix({
      identity,
      origin: "https://wiki.example",
      scope: "public",
    });
    const matching = `${prefix}4`;
    const names = [
      matching,
      `${prefix.replace("reader-v3", "reader-v4")}4`,
      `${prefix.replace("-public-", "-session-")}4`,
      "unrelated",
    ];
    const removed: string[] = [];
    const directory = {
      async *keys() {
        yield* names;
      },
      async removeEntry(name: string) {
        removed.push(name);
      },
    };

    const retired = await retirePreviousReaderStore({
      identity,
      origin: "https://wiki.example",
      scope: "public",
      storage: {
        getDirectory: async () => directory as unknown as FileSystemDirectoryHandle,
      } as StorageManager,
    });

    expect(retired).toEqual([matching]);
    expect(removed).toEqual([matching]);
  });
});
