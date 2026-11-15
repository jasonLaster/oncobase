import { afterEach, describe, expect, test } from "bun:test";
import {
  createSafeStorage,
  memoryBackedLocalStorage,
  resolveWebStorage,
  safeLocalStorage,
  safeSessionStorage,
} from "./index";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as Record<string, unknown>).window;
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
}

const securityError = () => new DOMException("The operation is insecure.", "SecurityError");

/** Every access, including reading `window.localStorage`, throws. */
function stubBlockedWindow() {
  const value = {};
  for (const kind of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(value, kind, { get: () => { throw securityError(); }, configurable: true });
  }
  Object.defineProperty(globalThis, "window", { value, configurable: true, writable: true });
}

function throwingStorage(): Storage {
  return {
    get length(): number { throw securityError(); },
    key() { throw securityError(); },
    getItem() { throw securityError(); },
    setItem() { throw new DOMException("full", "QuotaExceededError"); },
    removeItem() { throw securityError(); },
    clear() { throw securityError(); },
  };
}

describe("safe storage", () => {
  test("is inert without a window (server rendering)", () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(resolveWebStorage("localStorage")).toBeNull();
    expect(safeLocalStorage.getItem("key")).toBeNull();
    expect(safeLocalStorage.setItem("key", "1")).toBe(false);
    expect(() => safeLocalStorage.removeItem("key")).not.toThrow();
    expect(safeLocalStorage.keys()).toEqual([]);
  });

  test("never throws when the storage getter itself throws", () => {
    stubBlockedWindow();
    for (const storage of [safeLocalStorage, safeSessionStorage]) {
      expect(storage.getItem("key")).toBeNull();
      expect(storage.setItem("key", "1")).toBe(false);
      expect(() => storage.removeItem("key")).not.toThrow();
      expect(storage.keys()).toEqual([]);
    }
  });

  test("never throws when every operation throws", () => {
    const storage = createSafeStorage(throwingStorage);
    expect(storage.getItem("key")).toBeNull();
    expect(storage.setItem("key", "1")).toBe(false);
    expect(() => storage.removeItem("key")).not.toThrow();
    expect(storage.keys()).toEqual([]);
  });

  test("never throws when resolving storage throws", () => {
    const storage = createSafeStorage(() => { throw securityError(); });
    expect(storage.getItem("key")).toBeNull();
    expect(storage.setItem("key", "1")).toBe(false);
  });

  test("drops failed writes: a later read returns null, not the dropped value", () => {
    const storage = createSafeStorage(throwingStorage);
    storage.setItem("key", "1");
    expect(storage.getItem("key")).toBeNull();
  });

  test("passes through to working storage", () => {
    const backing = memoryStorage();
    const storage = createSafeStorage(() => backing);
    expect(storage.setItem("a", "1")).toBe(true);
    expect(backing.getItem("a")).toBe("1");
    expect(storage.getItem("a")).toBe("1");
    expect(storage.keys()).toEqual(["a"]);
    storage.removeItem("a");
    expect(storage.getItem("a")).toBeNull();
  });

  test("reads the real window storage objects", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: local, sessionStorage: session }, configurable: true, writable: true,
    });
    safeLocalStorage.setItem("k", "local");
    safeSessionStorage.setItem("k", "session");
    expect(local.getItem("k")).toBe("local");
    expect(session.getItem("k")).toBe("session");
  });

  test("returns the same primitive for the same state, so useSyncExternalStore snapshots stay stable", () => {
    const storage = createSafeStorage(throwingStorage, { memoryFallback: true });
    expect(storage.getItem("theme")).toBe(storage.getItem("theme"));
    storage.setItem("theme", "dark");
    expect(storage.getItem("theme")).toBe("dark");
    expect(storage.getItem("theme")).toBe(storage.getItem("theme"));
  });
});

describe("memory fallback", () => {
  test("remembers writes for the page when storage is blocked", () => {
    const storage = createSafeStorage(throwingStorage, { memoryFallback: true });
    expect(storage.setItem("theme", "dark")).toBe(false);
    expect(storage.getItem("theme")).toBe("dark");
    expect(storage.keys()).toEqual(["theme"]);
    storage.removeItem("theme");
    expect(storage.getItem("theme")).toBeNull();
    expect(storage.keys()).toEqual([]);
  });

  test("a failed write shadows the stale persisted value; a later successful write clears the shadow", () => {
    const backing = memoryStorage();
    backing.setItem("theme", "light");
    let full = true;
    const storage = createSafeStorage(() => ({
      get length() { return backing.length; },
      key: (index: number) => backing.key(index),
      getItem: (key: string) => backing.getItem(key),
      setItem: (key: string, value: string) => {
        if (full) throw new DOMException("full", "QuotaExceededError");
        backing.setItem(key, value);
      },
      removeItem: (key: string) => backing.removeItem(key),
    }), { memoryFallback: true });

    storage.setItem("theme", "dark");
    expect(storage.getItem("theme")).toBe("dark");
    full = false;
    expect(storage.setItem("theme", "light")).toBe(true);
    backing.setItem("theme", "system-from-another-tab");
    expect(storage.getItem("theme")).toBe("system-from-another-tab");
  });

  test("the shared memory-backed facade survives a blocked window", () => {
    stubBlockedWindow();
    memoryBackedLocalStorage.setItem("memory-test", "1");
    expect(memoryBackedLocalStorage.getItem("memory-test")).toBe("1");
    memoryBackedLocalStorage.removeItem("memory-test");
    expect(memoryBackedLocalStorage.getItem("memory-test")).toBeNull();
  });
});
