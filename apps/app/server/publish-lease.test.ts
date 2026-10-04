import { expect, test } from "bun:test";
import type { ConvexHttpClient } from "convex/browser";
import { getFunctionName, type FunctionReference } from "convex/server";
import { renewPublishLease } from "./publish-api";

function client(fail = false) {
  const calls: Array<{ name: string; args: unknown; skipQueue?: boolean }> = [];
  const fake = {
    async mutation(ref: FunctionReference<"mutation">, args: unknown, options?: { skipQueue?: boolean }) {
      calls.push({ name: getFunctionName(ref), args, skipQueue: options?.skipQueue });
      if (fail) throw new Error("Publish conflict: run lease expired");
      return { lockUntil: 1 };
    },
  };
  return { calls, client: fake as unknown as ConvexHttpClient };
}

test("owned runs renew their lease at most once per interval", async () => {
  const { calls, client: c } = client();
  const runId = "scoped:33333333-3333-3333-3333-333333333333";
  expect(await renewPublishLease(c, "alpha", runId, 1_000)).toBe(true);
  expect(await renewPublishLease(c, "alpha", runId, 30_000)).toBe(false);
  expect(await renewPublishLease(c, "alpha", runId, 61_000)).toBe(true);
  expect(await renewPublishLease(c, "beta", runId, 61_000)).toBe(true);
  expect(calls).toEqual([
    { name: "sites:renewPublish", args: { slug: "alpha", runId }, skipQueue: true },
    { name: "sites:renewPublish", args: { slug: "alpha", runId }, skipQueue: true },
    { name: "sites:renewPublish", args: { slug: "beta", runId }, skipQueue: true },
  ]);
});

test("legacy runs are not renewed and a failed renewal is retried on the next write", async () => {
  const { calls, client: c } = client(true);
  expect(await renewPublishLease(c, "alpha", undefined)).toBe(false);
  expect(await renewPublishLease(c, "alpha", "legacy-uuid")).toBe(false);
  expect(calls).toHaveLength(0);
  const runId = "scoped:44444444-4444-4444-4444-444444444444";
  expect(await renewPublishLease(c, "alpha", runId, 1_000)).toBe(false);
  expect(await renewPublishLease(c, "alpha", runId, 2_000)).toBe(false);
  expect(calls).toHaveLength(2);
});
