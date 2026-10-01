import { expect, test } from "bun:test";
import type { ConvexHttpClient } from "convex/browser";
import { handlePathologyRequest, tileEntry, validBlobUrl, publicSlide, type TileManifest } from "./pathology-api";

const manifest: TileManifest = { version: 1, slideId: "slide", sourceSha256: "hash", width: 2049, height: 1025, tileSize: 1024, overlap: 1, maxLevel: 12,
  packs: [{ url: "https://example.public.blob.vercel-storage.com/tile.bin", sizeBytes: 10000, sha256: "hash" }], tiles: { "12/2_1": [0, 3000, 2000], "12/0_0": [0, 9000, 2000] } };

test("tile proxy bounds edge tiles and rejects invalid and overflowing byte ranges", () => {
  expect(tileEntry(manifest, 12, 2, 1)).toEqual({ url: manifest.packs[0].url, offset: 3000, length: 2000 });
  for (const [l, x, y] of [[12, 3, 1], [12, 2, 2], [13, 0, 0], [12, -1, 0], [12, 1.5, 0]]) expect(tileEntry(manifest, l, x, y)).toBeNull();
  expect(() => tileEntry(manifest, 12, 0, 0)).toThrow("Invalid tile range");
});
test("storage origins cannot become an arbitrary server-side fetch", () => {
  for (const url of ["http://example.public.blob.vercel-storage.com/a", "https://localhost/a", "https://example.public.blob.vercel-storage.com.evil.test/a", "https://user@example.public.blob.vercel-storage.com/a", "https://example.public.blob.vercel-storage.com/a?secret=1"]) {
    expect(() => validBlobUrl(url)).toThrow();
  }
});
test("reader metadata excludes storage URLs and backend identities", () => {
  const reader = publicSlide({ slideId: "id", tileManifestUrl: "secret", tileManifestSha256: "secret", thumbnailUrl: "secret", _id: "private" } as never);
  expect(reader).not.toHaveProperty("tileManifestUrl");
  expect(reader).not.toHaveProperty("_id");
});

test("note requests cannot override the server's tenant or source and reject foreign origins", async () => {
  const slideId = `he-${"d".repeat(20)}`, sourceSha256 = "d".repeat(64);
  let saved: unknown;
  const client = {
    query: async () => ({ slideId, sourceSha256 }),
    mutation: async (_fn: unknown, args: unknown) => { saved = args; return { conflict: false, version: 1 }; },
  } as unknown as ConvexHttpClient;
  const body = { regions: [], expectedVersion: 0, sourceSha256, siteSlug: "foreign-tenant", slideId: "foreign-slide" };
  const request = (origin: string) => new Request(`https://fixture.example.test/api/pathology/slides/${slideId}/regions`, {
    method: "PUT", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
  });
  expect((await handlePathologyRequest(request("https://foreign.example.test"), client, "request-fixture")).status).toBe(403);
  expect(saved).toBeUndefined();
  expect((await handlePathologyRequest(request("https://fixture.example.test"), client, "request-fixture")).status).toBe(200);
  expect(saved).toEqual({ siteSlug: "request-fixture", slideId, sourceSha256, expectedVersion: 0, regions: [] });
});
