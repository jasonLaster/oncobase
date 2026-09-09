import { afterEach, beforeEach, expect, test } from "bun:test";
import { createCommandPaletteChords } from "@oncobase/wiki-shell";
import { installReaderShortcuts } from "./reader-shortcuts";

const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/missing-reader-page" } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: new EventTarget() });
});
afterEach(() => {
  window.__wikiReaderShortcuts?.controller.dispose();
  for (const [key, descriptor] of [["window", oldWindow], ["document", oldDocument]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("repeated startup installation preserves a queued shortcut and one controller", () => {
  installReaderShortcuts(createCommandPaletteChords);
  const startup = window.__wikiReaderShortcuts!;
  const key = new Event("keydown", { cancelable: true });
  Object.assign(key, { key: "o", code: "KeyO", metaKey: true });
  document.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(true);
  expect(startup.pending).toBe("pages");
  installReaderShortcuts(createCommandPaletteChords);
  expect(window.__wikiReaderShortcuts).toBe(startup);
  expect(startup.pending).toBe("pages");
});

for (const pathname of ["/login", "/terms-and-conditions", "/tools/dicom-viewer", "/tools/dicom-compare"]) {
  test(`${pathname} leaves browser shortcuts alone because it has no reader palette`, () => {
    window.location.pathname = pathname;
    installReaderShortcuts(createCommandPaletteChords);
    expect(window.__wikiReaderShortcuts).toBeUndefined();
  });
}
