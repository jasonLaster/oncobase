import { expect, test } from "bun:test";
import { runAfterResponse } from "./background";

test("post-response work is registered with waitUntil and never rejects", async () => {
  const registered: Promise<unknown>[] = [];
  runAfterResponse(Promise.reject(new Error("seed failed")), "fixture", task => registered.push(task));
  expect(registered).toHaveLength(1);
  await expect(registered[0]).resolves.toBeUndefined();
});

test("missing request context does not break the caller", async () => {
  let ran = false;
  runAfterResponse(Promise.resolve().then(() => { ran = true; }), "fixture", () => { throw new Error("no context"); });
  await Promise.resolve(); await Promise.resolve();
  expect(ran).toBe(true);
  // Default extender works outside Vercel too.
  expect(() => runAfterResponse(Promise.resolve())).not.toThrow();
});
