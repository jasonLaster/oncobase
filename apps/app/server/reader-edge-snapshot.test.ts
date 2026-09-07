import { expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { createReaderEdgeSnapshot } from "./reader-edge-snapshot";
import type { ReaderSnapshot } from "./reader-cache-context";
test("shared site policy validates page metadata across instances and publication or restriction changes replace the cached page", async () => {
  let now = 0, reads = 0;
  let snapshot: ReaderSnapshot = { siteSlug: "diana", contentRevision: "site:1", gate: { enabled: true, passwordHash: "first" }, piiPatterns: [],
    page: { slug: "index", title: "Home", bodyDigest: "original", contentHash: "source", content: null, description: undefined, tags: [], sensitive: false } };
  const values = new Map<string, unknown>(), tasks: Promise<unknown>[] = [];
  const shared = { get: async (key: string) => values.get(key), set: async (key: string, value: unknown) => { values.set(key, value); } };
  const options = { now: () => now, background: (task: Promise<unknown>) => { tasks.push(task); }, policyCache: shared, pageCache: shared };
  const client = { query: async (ref: Parameters<typeof getFunctionName>[0]) => { if (getFunctionName(ref).endsWith("getReaderPage")) reads++; return structuredClone(snapshot); } };
  const first = createReaderEdgeSnapshot(client as never, options);
  expect((await first.get("diana.test", "index"))?.page?.bodyDigest).toBe("original"); await Promise.all(tasks);
  now = 999;
  const second = createReaderEdgeSnapshot(client as never, options);
  expect((await second.get("diana.test", "index"))?.page?.bodyDigest).toBe("original"); expect(reads).toBe(1);
  snapshot = { ...snapshot, contentRevision: "site:2", page: { ...snapshot.page!, bodyDigest: "new" } }; now = 5000;
  expect((await second.get("diana.test", "index"))?.page?.bodyDigest).toBe("new"); expect(reads).toBe(2);
  snapshot = { ...snapshot, contentRevision: "site:3", page: null }; now = 10_000;
  expect((await second.get("diana.test", "index"))?.page).toBeNull();
  snapshot = { ...snapshot, gate: { enabled: true, passwordHash: "rotated" }, piiPatterns: ["redaction"] }; now = 15_000;
  const rotated = await second.get("diana.test", "index");
  expect(rotated?.gate.passwordHash).toBe("rotated"); expect(rotated?.piiPatterns).toEqual(["redaction"]);
});
