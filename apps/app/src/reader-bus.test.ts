import { afterEach, describe, expect, test } from "bun:test";
import { emit, on } from "./reader-bus";

const offs: Array<() => void> = [];
const listen: typeof on = (name, handler) => {
  const off = on(name, handler);
  offs.push(off);
  return off;
};
afterEach(() => { while (offs.length) offs.pop()!(); });

describe("reader bus", () => {
  test("delivers the payload to every handler, in subscription order", () => {
    const calls: string[] = [];
    listen("open-command-palette", mode => calls.push(`a:${mode}`));
    listen("open-command-palette", mode => calls.push(`b:${mode}`));
    emit("open-command-palette", "outline");
    expect(calls).toEqual(["a:outline", "b:outline"]);
  });

  test("delivers synchronously and only to handlers of that name", () => {
    let retried = 0;
    let refreshed = 0;
    listen("retry-page", () => { retried++; });
    listen("refresh-manifest", () => { refreshed++; });
    emit("retry-page");
    expect([retried, refreshed]).toEqual([1, 0]);
  });

  test("emitting with no handlers is a no-op", () => {
    expect(() => emit("warm-cache")).not.toThrow();
  });

  test("unsubscribe stops delivery and is idempotent", () => {
    let calls = 0;
    const off = listen("warm-cache", () => { calls++; });
    emit("warm-cache");
    off();
    off();
    emit("warm-cache");
    expect(calls).toBe(1);
  });

  test("the same handler subscribed twice runs once, like addEventListener", () => {
    let calls = 0;
    const handler = () => { calls++; };
    listen("foreground-fetch", handler);
    listen("foreground-fetch", handler);
    emit("foreground-fetch");
    expect(calls).toBe(1);
  });

  test("a handler removed during delivery does not run; one added waits for the next emit", () => {
    const calls: string[] = [];
    const late = () => calls.push("late");
    let offSecond = () => {};
    listen("agent-access-change", () => {
      calls.push("first");
      offSecond();
      listen("agent-access-change", late);
    });
    offSecond = listen("agent-access-change", () => calls.push("second"));
    emit("agent-access-change");
    expect(calls).toEqual(["first"]);
    emit("agent-access-change");
    expect(calls).toEqual(["first", "first", "late"]);
  });

  test("a throwing handler is reported and the rest still run", () => {
    const reported: unknown[] = [];
    const original = globalThis.reportError;
    globalThis.reportError = (error: unknown) => { reported.push(error); };
    try {
      const failure = new Error("boom");
      let ran = false;
      listen("refresh-manifest", () => { throw failure; });
      listen("refresh-manifest", () => { ran = true; });
      expect(() => emit("refresh-manifest")).not.toThrow();
      expect(ran).toBe(true);
      expect(reported).toEqual([failure]);
    } finally {
      globalThis.reportError = original;
    }
  });
});
