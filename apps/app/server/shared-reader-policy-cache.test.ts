import { expect, test } from "bun:test";
import { createSharedReaderPolicyCache } from "./shared-reader-policy-cache";
test("HTML hits can avoid opportunistic refresh without extending the policy's maximum age", async () => {
  let clock = 0, reads = 0, fail = false;
  const values = new Map<string, unknown>(), tasks: Promise<unknown>[] = [];
  const options = { now: () => clock, read: async () => { reads++; if (fail) throw new Error("offline"); return "policy"; },
    background: (task: Promise<unknown>) => { tasks.push(task); },
    shared: { get: async (key: string) => values.get(key), set: async (key: string, value: unknown) => { values.set(key, value); } } };
  const first = createSharedReaderPolicyCache(options);
  await first.get("site"); await Promise.all(tasks); tasks.length = 0;
  const second = createSharedReaderPolicyCache(options);
  clock = 4999;
  expect(await second.get("site", { backgroundRefresh: false })).toBe("policy");
  expect(reads).toBe(1); expect(tasks).toHaveLength(0);
  clock = 5000; fail = true;
  await expect(second.get("site", { backgroundRefresh: false })).rejects.toThrow("offline");
  fail = false;
  expect(await second.get("site", { backgroundRefresh: false })).toBe("policy");
  await Promise.all(tasks);
  const priorReads = reads;
  clock = 6001;
  expect(await second.get("site")).toBe("policy"); await Promise.all(tasks);
  expect(reads).toBe(priorReads + 1);
});
test("a second instance cannot extend shared policy freshness or serve it after a failed refresh", async () => {
  let clock = 0, reads = 0, fail = false;
  const values = new Map<string, unknown>(), tasks: Promise<unknown>[] = [];
  const options = { now: () => clock, read: async () => { reads++; if (fail) throw new Error("offline"); return "policy"; },
    background: (task: Promise<unknown>) => { tasks.push(task); },
    shared: { get: async (key: string) => values.get(key), set: async (key: string, value: unknown) => { values.set(key, value); } } };
  const first = createSharedReaderPolicyCache(options);
  expect(await first.get("site/page")).toBe("policy"); await Promise.all(tasks);
  clock = 999;
  const second = createSharedReaderPolicyCache(options);
  expect(await second.get("site/page")).toBe("policy"); expect(reads).toBe(1);
  clock = 4999; fail = true;
  expect(await second.get("site/page")).toBe("policy"); await Promise.all(tasks);
  clock = 5000;
  await expect(second.get("site/page")).rejects.toThrow("offline");
  await expect(createSharedReaderPolicyCache(options).get("site/page")).rejects.toThrow("offline");
});
test("unavailable shared cache falls back to a fresh read and immediate mode bypasses both cache layers", async () => {
  let calls = 0;
  const cache = createSharedReaderPolicyCache({ maxAgeMs: 0, read: async () => ++calls,
    shared: { get: async () => { throw new Error("must not read shared"); }, set: async () => { throw new Error("must not write shared"); } } });
  expect(await cache.get("a")).toBe(1); expect(await cache.get("a")).toBe(2);
  const fallback = createSharedReaderPolicyCache({ read: async () => "fresh", background: () => {},
    shared: { get: async () => { throw new Error("unavailable"); }, set: async () => {} } });
  expect(await fallback.get("a")).toBe("fresh");
});
