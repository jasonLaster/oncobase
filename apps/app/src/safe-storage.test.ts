import { afterEach, describe, expect, test } from "bun:test";
import { readLiveStoreDevtoolsEnabled } from "./livestore/devtools";
import { safeLocalStorage } from "./safe-storage";

const original = Object.getOwnPropertyDescriptor(globalThis, "window");

function stubWindow(href: string, localStorage: () => Storage) {
  const value = { location: { href } };
  Object.defineProperty(value, "localStorage", { get: localStorage, configurable: true });
  Object.defineProperty(globalThis, "window", { value, configurable: true, writable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else delete (globalThis as Record<string, unknown>).window;
});

describe("safeLocalStorage", () => {
  test("never throws when the storage accessor itself is blocked", () => {
    stubWindow("https://wiki.test/", () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(safeLocalStorage.getItem("key")).toBeNull();
    expect(() => safeLocalStorage.setItem("key", "1")).not.toThrow();
    expect(() => safeLocalStorage.removeItem("key")).not.toThrow();
  });

  test("never throws when individual operations fail", () => {
    const failing = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new DOMException("full", "QuotaExceededError"); },
      removeItem() { throw new Error("blocked"); },
    } as unknown as Storage;
    stubWindow("https://wiki.test/", () => failing);
    expect(safeLocalStorage.getItem("key")).toBeNull();
    expect(() => safeLocalStorage.setItem("key", "1")).not.toThrow();
    expect(() => safeLocalStorage.removeItem("key")).not.toThrow();
  });
});

describe("readLiveStoreDevtoolsEnabled", () => {
  test("still honours the URL preference when storage is blocked", () => {
    const blocked = () => { throw new DOMException("insecure", "SecurityError"); };
    stubWindow("https://wiki.test/page?livestoreDevtools=1", blocked);
    expect(readLiveStoreDevtoolsEnabled()).toBe(true);
    stubWindow("https://wiki.test/page", blocked);
    expect(readLiveStoreDevtoolsEnabled()).toBe(false);
  });
});
