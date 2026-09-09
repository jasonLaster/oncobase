import { afterEach, beforeEach, expect, test } from "bun:test";
import { createCommandPaletteChords, type CommandPaletteChordController } from "./command-palette-chords";

let documentTarget: EventTarget;
let controller: CommandPaletteChordController | undefined;
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeEach(() => {
  documentTarget = new EventTarget();
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentTarget });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
});
afterEach(() => {
  controller?.dispose();
  for (const [key, descriptor] of [["document", oldDocument], ["window", oldWindow]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function key(code: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { code, key: code === "Escape" ? code : code.slice(-1), metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers });
  documentTarget.dispatchEvent(event);
  return event.defaultPrevented;
}
const settleChord = () => new Promise(resolve => setTimeout(resolve, 650));

test("native Search clicks adopt live handlers, cancel a chord, and stop after disposal", async () => {
  const oldElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  class Target {
    closest(selector: string) { return selector === "[data-reader-file-palette]" ? this : null; }
  }
  Object.defineProperty(globalThis, "Element", { configurable: true, value: Target });
  const click = () => {
    const event = new Event("click", { cancelable: true });
    Object.defineProperty(event, "target", { value: new Target() });
    documentTarget.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    const calls: string[] = [];
    controller = createCommandPaletteChords({ onFiles: () => calls.push("early") });
    expect(click()).toBe(true);
    controller.setHandlers({ onFiles: () => calls.push("live") });
    key("KeyK", { metaKey: true });
    expect(click()).toBe(true);
    await settleChord();
    expect(calls).toEqual(["early", "live", "live"]);
    controller.dispose();
    expect(click()).toBe(false);
    expect(calls).toEqual(["early", "live", "live"]);
  } finally {
    if (oldElement) Object.defineProperty(globalThis, "Element", oldElement);
    else Reflect.deleteProperty(globalThis, "Element");
  }
});

test("Cmd+O and Ctrl+O prevent the browser action and open files", () => {
  let files = 0;
  controller = createCommandPaletteChords({ onFiles: () => files++ });
  expect(key("KeyO", { metaKey: true })).toBe(true);
  expect(key("KeyO", { ctrlKey: true })).toBe(true);
  expect(files).toBe(2);
});

test("adopting application handlers preserves an in-progress chord", async () => {
  const calls: string[] = [];
  controller = createCommandPaletteChords({ onFiles: () => calls.push("early files") });
  key("KeyK", { metaKey: true });
  controller.setHandlers({ onFiles: () => calls.push("files"), onOutline: () => calls.push("outline") });
  key("KeyO");
  await settleChord();
  expect(calls).toEqual(["early files", "outline"]);
});

test("Cmd+K opens synchronously and its chord expiry does not reopen the palette", async () => {
  const calls: string[] = [];
  controller = createCommandPaletteChords({ onFiles: () => calls.push("early") });
  key("KeyK", { metaKey: true });
  expect(calls).toEqual(["early"]);
  controller.setHandlers({ onFiles: () => calls.push("live") });
  await settleChord();
  expect(calls).toEqual(["early"]);
});

test("Ctrl+K opens files synchronously", () => {
  let files = 0;
  controller = createCommandPaletteChords({ onFiles: () => files++ });
  expect(key("KeyK", { ctrlKey: true })).toBe(true);
  expect(files).toBe(1);
});

test("a direct outline shortcut cancels the file chord without reopening files", async () => {
  const calls: string[] = [];
  controller = createCommandPaletteChords({ onFiles: () => calls.push("files"), onOutline: () => calls.push("outline") });
  key("KeyK", { metaKey: true });
  key("KeyO", { metaKey: true, shiftKey: true });
  await settleChord();
  expect(calls).toEqual(["files", "outline"]);
});

test("Escape cancels the chord and lets the host cancel a queued request", async () => {
  const calls: string[] = [];
  controller = createCommandPaletteChords({ onFiles: () => calls.push("files"), onCancel: () => calls.push("cancel") });
  key("KeyK", { metaKey: true });
  key("Escape");
  await settleChord();
  expect(calls).toEqual(["files", "cancel"]);
});

test("teardown removes the browser shortcut interception and pending timer", async () => {
  let calls = 0;
  controller = createCommandPaletteChords({ onFiles: () => calls++ });
  key("KeyK", { metaKey: true });
  controller.dispose();
  expect(key("KeyO", { metaKey: true })).toBe(false);
  await settleChord();
  expect(calls).toBe(1);
});
