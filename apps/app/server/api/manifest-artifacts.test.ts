import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { artifactObjectKey, blobReadOrigin, createManifestArtifactStore } from "./manifest-artifacts";

const env = { WIKI_GATE_SESSION_SECRET: "fixture-secret", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_Store123_secret", VERCEL_BLOB_API_URL: "http://127.0.0.1:3999/api/blob" };

test("object names are keyed HMACs, not derivable from the manifest hash", () => {
  const key = "manifest/v1-s1/diana/abc123/compact-v1.json.gz";
  const name = artifactObjectKey("fixture-secret", key);
  expect(name).toMatch(/^manifest-artifacts\/[a-f0-9]{64}\.bin$/);
  expect(name).not.toContain("abc123");
  expect(artifactObjectKey("other-secret", key)).not.toBe(name);
});

test("read origins: the local stand-in, or the public store from the token", () => {
  expect(blobReadOrigin(env)).toBe("http://127.0.0.1:3999");
  expect(blobReadOrigin({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_Store123_secret" })).toBe("https://Store123.public.blob.vercel-storage.com");
  expect(blobReadOrigin({})).toBeNull();
});

test("disabled without a secret, a token, or when switched off", () => {
  expect(createManifestArtifactStore("diana", { env: { ...env, WIKI_GATE_SESSION_SECRET: "" } })).toBeUndefined();
  expect(createManifestArtifactStore("diana", { env: { ...env, BLOB_READ_WRITE_TOKEN: undefined } })).toBeUndefined();
  expect(createManifestArtifactStore("diana", { env: { ...env, WIKI_MANIFEST_ARTIFACTS: "0" } })).toBeUndefined();
});

test("round trip through the site prefix; misses and non-gzip bodies read as null", async () => {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const writes: string[] = [];
  const store = createManifestArtifactStore("diana", {
    env,
    write: async (key, body) => { writes.push(key); objects.set(`/sites/diana/${key}`, body); },
    fetchImpl: (async (url: string) => {
      const body = objects.get(new URL(url).pathname);
      return body ? new Response(body) : new Response("missing", { status: 404 });
    }) as typeof fetch,
  })!;
  const key = "manifest/v1-s1/diana/hash/compact-v1.json.gz";
  expect(await store.get(key)).toBeNull();
  const body: Uint8Array<ArrayBuffer> = new Uint8Array(gzipSync(JSON.stringify({ pages: Array.from({ length: 50 }, (_, i) => i) })));
  store.put(key, body);
  store.put(key, body); // written once per instance
  await Bun.sleep(10);
  expect(writes).toEqual([artifactObjectKey("fixture-secret", key)]);
  expect(await store.get(key)).toEqual(body);
  objects.set(`/sites/diana/${artifactObjectKey("fixture-secret", "plain")}`, new TextEncoder().encode("not gzip at all, just text"));
  expect(await store.get("plain")).toBeNull();
});
