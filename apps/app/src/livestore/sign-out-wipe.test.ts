import { describe, expect, test } from "bun:test";
import { makeWikiStoreId, WIKI_PREVIOUS_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { isSigningOut, shutDownAndWipeReaderStores, SIGN_OUT_WIPE_KEY, wipeReaderStoresOnSignOut } from "./cache-retirement";

const origin = "https://wiki.example";
const dir = (siteSlug: string, scope: "public" | "session", cacheKey: string, readerCacheVersion?: string) =>
  `livestore-${makeWikiStoreId({ siteSlug, scope, origin, cacheKey, ...(readerCacheVersion ? { readerCacheVersion } : {}) })}@4`;

function fakeStorage(names: string[], { locked = new Set<string>() } = {}) {
  const present = new Set(names);
  const directory = {
    async *keys() { yield* [...present]; },
    async removeEntry(name: string) {
      if (locked.has(name)) throw new DOMException("in use", "NoModificationAllowedError");
      present.delete(name);
    },
  };
  return { present, storage: { getDirectory: async () => directory as unknown as FileSystemDirectoryHandle } as StorageManager };
}

describe("P11 sign-out OPFS wipe", () => {
  const signedOut = dir("diana", "session", "user-a");
  const previousVersion = dir("diana", "session", "user-a", WIKI_PREVIOUS_READER_CACHE_VERSION);
  const olderSession = dir("diana", "session", "user-b");
  const publicStore = dir("diana", "public", "anonymous");
  const otherSite = dir("other", "session", "user-a");

  test("a known site loses every session store, and keeps public stores and other sites", async () => {
    const { present, storage } = fakeStorage([signedOut, previousVersion, olderSession, publicStore, otherSite, "unrelated"]);
    const result = await wipeReaderStoresOnSignOut({ origin, siteSlug: "diana", storage });
    expect(result.target).toBe("site");
    expect(result.retired.sort()).toEqual([signedOut, previousVersion, olderSession].sort());
    expect([...present].sort()).toEqual([publicStore, otherSite, "unrelated"].sort());
  });

  test("an unknown identity loses every reader store on the origin", async () => {
    const { present, storage } = fakeStorage([signedOut, publicStore, otherSite, "unrelated"]);
    const result = await wipeReaderStoresOnSignOut({ origin, siteSlug: null, storage });
    expect(result.target).toBe("all");
    expect([...present]).toEqual(["unrelated"]);
  });

  test("a store held open elsewhere is reported, and the rest still goes", async () => {
    const { present, storage } = fakeStorage([signedOut, olderSession], { locked: new Set([olderSession]) });
    const result = await wipeReaderStoresOnSignOut({ origin, siteSlug: "diana", storage });
    expect(result.retired).toEqual([signedOut]);
    expect(result.failed).toEqual([olderSession]);
    expect([...present]).toEqual([olderSession]);
  });

  test("shuts the store down before wiping, records the outcome, and survives a hung shutdown", async () => {
    const order: string[] = [];
    const { storage } = fakeStorage([signedOut]);
    const wrapped = { getDirectory: async () => { order.push("wipe"); return storage.getDirectory(); } } as StorageManager;
    const saved = new Map<string, string>();
    const result = await shutDownAndWipeReaderStores({
      store: { shutdown: () => { order.push("shutdown"); return new Promise<void>(() => {}); } },
      origin, siteSlug: "diana", storage: wrapped, shutdownTimeoutMs: 10,
      sessionStorage: { setItem: (key, value) => saved.set(key, value) },
    });
    expect(order).toEqual(["shutdown", "wipe"]);
    expect(result.retired).toEqual([signedOut]);
    expect(JSON.parse(saved.get(SIGN_OUT_WIPE_KEY)!).retired).toEqual([signedOut]);
    expect(isSigningOut()).toBe(true);
  });

  test("no OPFS at all is not an error", async () => {
    const result = await wipeReaderStoresOnSignOut({ origin, siteSlug: "diana", storage: {} as StorageManager });
    expect(result).toEqual({ target: "site", retired: [], failed: [] });
  });
});
