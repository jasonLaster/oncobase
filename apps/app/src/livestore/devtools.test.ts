import { afterEach, describe, expect, test } from "bun:test";
import { readLiveStoreDevtoolsEnabled } from "./devtools";

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

// The facade itself is tested in packages/safe-storage.
describe("readLiveStoreDevtoolsEnabled", () => {
  test("still honours the URL preference when storage is blocked", () => {
    const blocked = () => { throw new DOMException("insecure", "SecurityError"); };
    stubWindow("https://wiki.test/page?livestoreDevtools=1", blocked);
    expect(readLiveStoreDevtoolsEnabled()).toBe(true);
    stubWindow("https://wiki.test/page", blocked);
    expect(readLiveStoreDevtoolsEnabled()).toBe(false);
  });
});
