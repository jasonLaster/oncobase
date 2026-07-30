import { describe, expect, test } from "bun:test";
import { makePublicWikiSessionIdentity } from "@oncobase/wiki-content";
import type { PageContentRow, PageIndexRow, SiteStateRow } from "../types";
import {
  isCurrentReaderHydrated,
  isCurrentReaderManifestValidated,
  isRouteUnavailableInCurrentReader,
  previousReaderStoreDirectoryPrefix,
  requestSessionCacheCleanup,
  retireRequestedSessionReaderStores,
  retirePreviousReaderStore,
  sessionCacheCleanupKey,
  sessionReaderStoreDirectoryPrefixes,
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
const index: PageIndexRow = {
  slug: page.slug,
  title: page.title,
  tagsJson: page.tagsJson,
  description: null,
  contentHash: page.contentHash,
  sensitive: false,
  size: page.size,
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

  test("only treats route availability as authoritative after manifest validation", () => {
    expect(
      isCurrentReaderManifestValidated({
        identity,
        state,
        scope: "public",
      }),
    ).toBe(true);
    expect(
      isCurrentReaderManifestValidated({
        identity,
        state: { ...state, lastValidatedAt: 0 },
        scope: "public",
      }),
    ).toBe(false);
    expect(isRouteUnavailableInCurrentReader({ index, page })).toBe(false);
    expect(isRouteUnavailableInCurrentReader({ index: null, page })).toBe(true);
    expect(
      isRouteUnavailableInCurrentReader({
        index: { ...index, sensitive: true },
        page,
      }),
    ).toBe(true);
    expect(
      isRouteUnavailableInCurrentReader({
        index,
        page: { ...page, contentStatus: "deleted" },
      }),
    ).toBe(true);
    expect(
      isRouteUnavailableInCurrentReader({
        index,
        page: { ...page, contentStatus: "sensitive-unavailable" },
      }),
    ).toBe(true);
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

  test("clears current and N-1 session stores after sign-out without touching public caches", async () => {
    const localValues = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: (key: string) => localValues.delete(key),
    };
    requestSessionCacheCleanup(localStorage, "diana");

    const prefixes = sessionReaderStoreDirectoryPrefixes({
      origin: "https://wiki.example",
      siteSlug: "diana",
    });
    const names = [
      `${prefixes[0]}user-current@4`,
      `${prefixes[1]}user-previous@3`,
      prefixes[0]!.replace("-session-", "-public-") + "public@4",
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

    const retired = await retireRequestedSessionReaderStores({
      localStorage,
      origin: "https://wiki.example",
      siteSlug: "diana",
      storage: {
        getDirectory: async () => directory as unknown as FileSystemDirectoryHandle,
      } as StorageManager,
    });

    expect(retired).toEqual(names.slice(0, 2));
    expect(removed).toEqual(names.slice(0, 2));
    expect(localValues.has(sessionCacheCleanupKey("diana"))).toBe(false);
  });

  test("keeps the cleanup request when an open tab blocks deletion", async () => {
    const localValues = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: (key: string) => localValues.delete(key),
    };
    requestSessionCacheCleanup(localStorage, "diana");
    const [prefix] = sessionReaderStoreDirectoryPrefixes({
      origin: "https://wiki.example",
      siteSlug: "diana",
    });
    const directory = {
      async *keys() {
        yield `${prefix}open-tab@4`;
      },
      async removeEntry() {
        throw new Error("database is open");
      },
    };

    await retireRequestedSessionReaderStores({
      localStorage,
      origin: "https://wiki.example",
      siteSlug: "diana",
      storage: {
        getDirectory: async () => directory as unknown as FileSystemDirectoryHandle,
      } as StorageManager,
    });

    expect(localValues.get(sessionCacheCleanupKey("diana"))).toBe("1");
  });
});
