import { expect, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import { fetchAccessibleSlugs, fetchSlugSensitivity, mapChunks } from "./slug-batch";

test("mapChunks preserves order and bounds concurrency", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapChunks(Array.from({ length: 25 }, (_, index) => index), async (chunk) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return chunk.map(value => value * 2);
  }, { size: 3, concurrency: 2 });
  expect(result).toEqual(Array.from({ length: 25 }, (_, index) => index * 2));
  expect(peak).toBe(2);
  expect(await mapChunks([], async () => [1])).toEqual([]);
});

function countingClient(sensitive: Set<string>, denied: Set<string>) {
  const calls: Array<{ name: string; slugs: string[]; siteSlug: unknown }> = [];
  return {
    calls,
    client: {
      async query(ref: FunctionReference<"query">, args: { slugs: string[]; siteSlug: string }) {
        const name = getFunctionName(ref);
        calls.push({ name, slugs: args.slugs, siteSlug: args.siteSlug });
        if (name === "documents:getSensitivityBySlugs") {
          return args.slugs.filter(slug => !slug.startsWith("missing")).map(slug => ({ slug, sensitive: sensitive.has(slug) }));
        }
        if (name === "access:filterAccessibleSlugs") {
          return args.slugs.map(slug => ({ slug, allowed: !denied.has(slug), hasDocument: true }));
        }
        throw new Error(`Unexpected ${name}`);
      },
    },
  };
}

test("comment-room scale sensitivity lookups use chunked calls, not one per slug", async () => {
  const slugs = Array.from({ length: 798 }, (_, index) => `page-${index}`);
  const { client, calls } = countingClient(new Set(["page-3", "page-700"]), new Set());
  const result = await fetchSlugSensitivity(client as never, "alpha", [...slugs, "page-3", "missing-1"]);
  expect(calls).toHaveLength(8);
  expect(calls.every(call => call.slugs.length <= 100 && call.siteSlug === "alpha")).toBe(true);
  expect(result.get("page-3")).toBe(true);
  expect(result.get("page-700")).toBe(true);
  expect(result.get("page-4")).toBe(false);
  expect(result.has("missing-1")).toBe(false);
});

test("accessible slug checks are batched and deny anonymous users without RPCs", async () => {
  const { client, calls } = countingClient(new Set(), new Set(["b"]));
  expect(await fetchAccessibleSlugs(client as never, "alpha", null, ["a", "b"])).toEqual(new Set());
  expect(calls).toHaveLength(0);
  const user = { _id: "user_1" } as never;
  expect(await fetchAccessibleSlugs(client as never, "alpha", user, ["a", "b", "a"])).toEqual(new Set(["a"]));
  expect(calls).toHaveLength(1);
  expect(calls[0]!.slugs).toEqual(["a", "b"]);
  expect(await fetchAccessibleSlugs(client as never, "alpha", user, [])).toEqual(new Set());
  expect(calls).toHaveLength(1);
});
