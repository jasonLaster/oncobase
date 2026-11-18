import { expect, test } from "bun:test";
import type { WikiApiContext } from "@oncobase/wiki-content/server";
import { handlePalettePickRequest, type PalettePick } from "./palette-pick";

function fixture(signedIn: boolean) {
  const picks: PalettePick[] = [];
  const context = {
    getSessionUser: async () => signedIn ? { _id: "reader" } : null,
    documents: { getBySlug: async ({ slug }: { slug: string }) => slug === "gone" ? null : ({ slug, sensitive: slug !== "public" }) },
    access: { canUserAccessSlug: async (_user: unknown, slug: string) => slug === "allowed" },
  } as unknown as WikiApiContext;
  const pick = { query: "tissue overview", slug: "public", position: 1, recommended: true, recommendedSlugs: ["public"] };
  const request = (body: unknown, { scope = "session", origin = "https://example.test", testRun = false, method = "POST" } = {}) =>
    new Request(`https://example.test/api/wiki/palette-pick?scope=${scope}`, {
      method, headers: { origin, "content-type": "application/json", ...(testRun ? { "x-wiki-test-run": "1" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  const send = (body: unknown, options?: Parameters<typeof request>[1]) => handlePalettePickRequest(request(body, options), context, async row => { picks.push(row); });
  return { picks, pick, send };
}

test("records the query and the page opened, and whether the reader was signed in", async () => {
  const f = fixture(true);
  expect((await f.send(f.pick)).status).toBe(204);
  expect((await f.send({ ...f.pick, slug: "allowed" }, { scope: "public" })).status).toBe(404);
  expect((await f.send({ ...f.pick, slug: "allowed" })).status).toBe(204);
  expect(f.picks).toEqual([{ ...f.pick, signedIn: true }, { ...f.pick, slug: "allowed", signedIn: true }]);
});

test("cross-site, QA, malformed and unreadable picks are never stored", async () => {
  const f = fixture(false);
  expect((await f.send(f.pick, { origin: "https://evil.test" })).status).toBe(403);
  expect((await f.send(f.pick, { testRun: true })).status).toBe(204);
  expect((await f.send({ ...f.pick, query: "" })).status).toBe(400);
  expect((await f.send({ ...f.pick, recommendedSlugs: Array(11).fill("public") })).status).toBe(400);
  expect((await f.send({ ...f.pick, slug: "private" })).status).toBe(404);
  expect((await f.send({ ...f.pick, slug: "gone" })).status).toBe(404);
  expect((await f.send(f.pick, { method: "GET" })).status).toBe(405);
  expect(f.picks).toEqual([]);
});
