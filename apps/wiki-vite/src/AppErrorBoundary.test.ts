import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  clearLocalWikiData,
  isChunkLoadError,
  reloadOnceForLoadError,
} from "./AppErrorBoundary";

const descriptors = ["navigator", "indexedDB", "window"] as const;
const originals = new Map<string, PropertyDescriptor | undefined>(
  descriptors.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

function stub(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

describe("clearLocalWikiData", () => {
  test("removes OPFS entries, IndexedDB databases, and the scope key", async () => {
    const removeEntry = mock(async (_name: string, _options?: { recursive?: boolean }) => {});
    const deleteDatabase = mock((_name: string) => {});
    const removeItem = mock((_key: string) => {});

    async function* keys() {
      yield "livestore-wiki-vite-reader-v3-diana-public";
      yield "another-store";
    }

    stub("navigator", {
      storage: { getDirectory: async () => ({ keys, removeEntry }) },
    });
    stub("indexedDB", {
      databases: async () => [{ name: "livestore" }, { name: null }, { name: "keyval" }],
      deleteDatabase,
    });
    stub("window", { localStorage: { removeItem } });

    await clearLocalWikiData();

    expect(removeEntry).toHaveBeenCalledTimes(2);
    expect(removeEntry.mock.calls[0]?.[0]).toBe("livestore-wiki-vite-reader-v3-diana-public");
    expect(removeEntry.mock.calls).toEqual([
      ["livestore-wiki-vite-reader-v3-diana-public", { recursive: true }],
      ["another-store", { recursive: true }],
    ]);
    expect(deleteDatabase).toHaveBeenCalledTimes(2);
    expect(deleteDatabase.mock.calls).toEqual([["livestore"], ["keyval"]]);
    expect(removeItem).toHaveBeenCalledWith("wiki-vite-scope");
  });

  test("resolves even when OPFS and IndexedDB are unavailable", async () => {
    const removeItem = mock((_key: string) => {});
    stub("navigator", {});
    stub("indexedDB", {});
    stub("window", { localStorage: { removeItem } });

    await expect(clearLocalWikiData()).resolves.toBeUndefined();
    expect(removeItem).toHaveBeenCalledWith("wiki-vite-scope");
  });
});

describe("isChunkLoadError", () => {
  test("matches Vite dynamic-import and CSS preload failures", () => {
    for (const message of [
      "Unable to preload CSS for /assets/src-BrbTFx9E.css",
      "Failed to fetch dynamically imported module: https://x/assets/LiveStoreRoot-abc.js",
      "Unable to preload module for /assets/chunk.js",
      "error loading dynamically imported module",
      "Importing a module script failed.",
    ]) {
      expect(isChunkLoadError(new Error(message))).toBe(true);
    }
  });

  test("does not match unrelated runtime errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(new Error("LiveStore failed to open store"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("reloadOnceForLoadError", () => {
  test("reloads only once per tab session", () => {
    const store = new Map<string, string>();
    const reload = mock(() => {});
    stub("window", {
      location: { reload },
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });

    expect(reloadOnceForLoadError()).toBe(true);
    expect(reloadOnceForLoadError()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
