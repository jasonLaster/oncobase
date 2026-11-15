// P10: durable, content-addressed public manifest bytes in Vercel Blob, so a
// new instance serves an already-encoded snapshot instead of reading the
// snapshot from Convex storage and re-compacting and re-compressing it.
//
// Why Blob and not Vercel Runtime Cache: the key is immutable content (the
// snapshot hash), so durability across regions, deploys and instance churn is
// what we want and expiry buys nothing; Blob is already a dependency with a
// local stand-in, so the same code path runs on the local stack and in CI;
// Runtime Cache is per region and falls back to a per-process memory cache
// off Vercel, which would make "survives a new instance" unverifiable locally.
//
// What is stored: only public-scope representations (the gate-protected
// public manifest a password holder can already read). Session manifests carry
// private titles and stay in the per-instance memo. The store is public-access,
// so the object name is an HMAC of the key under a server secret: it cannot be
// derived from a manifest hash, and the URL never leaves the server.
import crypto from "node:crypto";
import type { ManifestArtifactStore } from "@oncobase/wiki-content/server";
import { traceBackendCache } from "../backend-tracing";
import { runAfterResponse } from "../background";

const READ_TIMEOUT_MS = 1_500;
const MAX_BYTES = 8 * 1024 * 1024;

type Env = Record<string, string | undefined>;

/** Public read origin of the Blob store: the local stand-in serves objects at
 * its API origin; a real store at https://<storeId>.public.blob.vercel-storage.com. */
export function blobReadOrigin(env: Env = process.env) {
  const api = env.VERCEL_BLOB_API_URL?.trim();
  if (api) {
    try { return new URL(api).origin; } catch { return null; }
  }
  const storeId = env.BLOB_READ_WRITE_TOKEN?.split("_")[3];
  return storeId && /^[A-Za-z0-9]+$/.test(storeId) ? `https://${storeId}.public.blob.vercel-storage.com` : null;
}

export function artifactObjectKey(secret: string, key: string) {
  return `manifest-artifacts/${crypto.createHmac("sha256", secret).update(`manifest-artifact:v1:${key}`).digest("hex")}.bin`;
}

export function createManifestArtifactStore(siteSlug: string, {
  env = process.env,
  fetchImpl = fetch,
  write,
}: {
  env?: Env;
  fetchImpl?: typeof fetch;
  write?: (key: string, body: Uint8Array<ArrayBuffer>) => Promise<unknown>;
} = {}): ManifestArtifactStore | undefined {
  if (env.WIKI_MANIFEST_ARTIFACTS === "0") return undefined;
  const secret = env.WIKI_GATE_SESSION_SECRET?.trim();
  const origin = blobReadOrigin(env);
  if (!secret || !origin || !env.BLOB_READ_WRITE_TOKEN) return undefined;
  const objectKey = (key: string) => artifactObjectKey(secret, key);
  const put = write ?? (async (key: string, body: Uint8Array<ArrayBuffer>) => {
    // Lazy: keeps @vercel/blob out of the API function's startup graph.
    const { sitePut } = await import("../blob");
    await sitePut(siteSlug, key, Buffer.from(body), {
      addRandomSuffix: false, allowOverwrite: true, contentType: "application/octet-stream",
      cacheControlMaxAge: 365 * 24 * 60 * 60,
    });
  });
  const written = new Set<string>();
  return {
    async get(key) {
      const response = await fetchImpl(`${origin}/sites/${siteSlug}/${objectKey(key)}`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) }).catch(() => null);
      if (!response?.ok) {
        traceBackendCache("manifest-artifact", false);
        await response?.body?.cancel().catch(() => undefined);
        return null;
      }
      const body = new Uint8Array(await response.arrayBuffer());
      // A gzip member always starts 1f 8b; anything else is not ours.
      const valid = body.byteLength > 18 && body.byteLength <= MAX_BYTES && body[0] === 0x1f && body[1] === 0x8b;
      traceBackendCache("manifest-artifact", valid);
      return valid ? body : null;
    },
    put(key, body) {
      if (written.has(key) || body.byteLength > MAX_BYTES) return;
      written.add(key);
      runAfterResponse(put(objectKey(key), body).catch((error) => {
        written.delete(key);
        throw error;
      }), "manifest artifact");
    },
  };
}
