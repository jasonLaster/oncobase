import { expect, test } from "bun:test";
import { createReaderPolicyCache } from "./reader-policy-cache";

test("hits do not extend the five-second policy lifetime; failed reads never serve expired policy", async () => {
  let clock = 0, calls = 0, fail = false;
  const cache = createReaderPolicyCache({ now: () => clock, read: async () => {
    calls++; if (fail) throw new Error("offline"); return calls;
  } });
  expect(await cache.get("a")).toBe(1);
  clock = 4999;
  expect(await cache.get("a")).toBe(1);
  clock = 5000; fail = true;
  await expect(cache.get("a")).rejects.toThrow("offline");
  fail = false;
  expect(await cache.get("a")).toBe(3);
});

test("concurrent misses share a lookup and an older result cannot replace a newer page policy", async () => {
  let resolve!: (value: string) => void, calls = 0;
  const cache = createReaderPolicyCache({ read: () => { calls++; return new Promise<string>(r => { resolve = r; }); } });
  const first = cache.get("a"), second = cache.get("a");
  cache.put("a", "new", cache.begin());
  resolve("old");
  expect(await first).toBe("new"); expect(await second).toBe("new");
  expect(await cache.get("a")).toBe("new"); expect(calls).toBe(1);
});

test("background refresh failure leaves only the original bounded lifetime", async () => {
  let clock = 0, calls = 0;
  const tasks: Promise<unknown>[] = [];
  const cache = createReaderPolicyCache({ now: () => clock, background: task => { tasks.push(task); },
    read: async () => { if (++calls > 1) throw new Error("offline"); return "initial"; } });
  await cache.get("a"); clock = 1000;
  expect(await cache.get("a")).toBe("initial");
  await Promise.all(tasks); clock = 5000;
  await expect(cache.get("a")).rejects.toThrow("offline");
});

test("a slow lookup cannot install an already expired authorization policy", async () => {
  let clock = 0;
  const cache = createReaderPolicyCache({ now: () => clock, read: async () => { clock += 5001; return "old"; } });
  await expect(cache.get("a")).rejects.toThrow("freshness window");
});
