import { expect, test } from "bun:test";
import { loadAllowedSensitiveSlugs, loadAllowedSensitivePages } from "./allowed-sensitive-slugs";

test("combined access pages keep order, retry the same cursor, and reject incomplete or failed scans", async () => {
  const calls: Array<[string | null, number]> = [];
  const result = await loadAllowedSensitivePages(async (cursor, size) => {
    calls.push([cursor, size]);
    if (cursor === "next" && size === 1000) throw new Error("read budget");
    return cursor === null ? { slugs: ["a"], isDone: false, continueCursor: "next" } :
      { slugs: ["b", "c"], isDone: true, continueCursor: null };
  });
  expect(result).toEqual(["a", "b", "c"]);
  expect(calls).toEqual([[null, 1000], ["next", 1000], ["next", 100]]);
  await expect(loadAllowedSensitivePages(async () => { throw new Error("unavailable"); })).rejects.toThrow("unavailable");
  await expect(loadAllowedSensitivePages(async () => ({ slugs: [], isDone: false, continueCursor: null }))).rejects.toThrow("Incomplete");
  expect(await loadAllowedSensitivePages(async () => ({ slugs: [], isDone: true, continueCursor: null }))).toEqual([]);
});

test("keeps identical allowed slugs with bounded permission checks and overlapping pagination", async () => {
  const documents = Array.from({ length: 2500 }, (_, index) => ({ slug: `page/${index}`, sensitive: index % 5 !== 0 }));
  const calls: Array<{ cursor: string | null; numItems: number }> = [];
  const checked: string[] = [];
  let active = 0, peak = 0, overlapping = false;
  const allowed = await loadAllowedSensitiveSlugs(async (cursor, numItems) => {
    calls.push({ cursor, numItems });
    if (active > 0) overlapping = true;
    const start = Number(cursor ?? 0);
    return { page: documents.slice(start, start + numItems), isDone: start + numItems >= documents.length, continueCursor: String(start + numItems) };
  }, async slugs => {
    expect(slugs.length).toBeLessThanOrEqual(100);
    peak = Math.max(peak, ++active);
    checked.push(...slugs);
    await Bun.sleep(1);
    active--;
    return slugs.map(slug => ({ slug, allowed: Number(slug.split("/")[1]) % 3 === 0 }));
  });
  expect(allowed).toEqual(documents.filter(document => document.sensitive && Number(document.slug.split("/")[1]) % 3 === 0).map(document => document.slug));
  expect(checked.length).toBe(documents.filter(document => document.sensitive).length);
  expect(new Set(checked).size).toBe(checked.length);
  expect(calls).toHaveLength(3);
  expect(peak).toBe(4);
  expect(overlapping).toBe(true);
});

test("retries an oversized metadata page at the original size and propagates access failures", async () => {
  const sizes: number[] = [];
  const read = async (_cursor: string | null, size: number) => {
    sizes.push(size);
    if (size > 100) throw new Error("read budget exceeded");
    return { page: [{ slug: "private", sensitive: true }], isDone: true, continueCursor: null };
  };
  expect(await loadAllowedSensitiveSlugs(read, async slugs => slugs.map(slug => ({ slug, allowed: false })))).toEqual([]);
  expect(sizes).toEqual([1000, 100]);
  await expect(loadAllowedSensitiveSlugs(read, async () => { throw new Error("access unavailable"); })).rejects.toThrow("access unavailable");
  await expect(loadAllowedSensitiveSlugs(async () => { throw new Error("metadata unavailable"); }, async () => [])).rejects.toThrow("metadata unavailable");
});

test("does not reuse authorization decisions between identities or after revocation", async () => {
  const read = async () => ({ page: [{ slug: "private", sensitive: true }, { slug: "public", sensitive: false }], isDone: true, continueCursor: null });
  let permitted = true;
  let calls = 0;
  const check = async (slugs: string[]) => { calls++; return slugs.map(slug => ({ slug, allowed: permitted })); };
  expect(await loadAllowedSensitiveSlugs(read, check)).toEqual(["private"]);
  permitted = false;
  expect(await loadAllowedSensitiveSlugs(read, check)).toEqual([]);
  expect(calls).toBe(2);
});
