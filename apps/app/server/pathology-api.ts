import { createHash } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { PathologyRegion, PathologySlide } from "@oncobase/diagnostics/pathology/model";

type StoredSlide = PathologySlide & { tileManifestUrl: string; tileManifestSha256: string; thumbnailUrl: string };
export interface TileManifest {
  version: number; slideId: string; sourceSha256: string; width: number; height: number;
  tileSize: number; overlap: number; maxLevel: number;
  packs: Array<{ url: string; sizeBytes: number; sha256: string }>;
  tiles: Record<string, [number, number, number]>;
}
const slideCache = new Map<string, { expires: number; value: Promise<StoredSlide | null> }>();
const manifestCache = new Map<string, { expires: number; value: Promise<TileManifest> }>();
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export function validBlobUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)
    || url.username || url.password || url.port || url.search || url.hash) throw new Error("Invalid pathology storage origin");
  return url.href;
}

function cached<T>(cache: Map<string, { expires: number; value: Promise<T> }>, key: string, loader: () => Promise<T>) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  const value = loader();
  cache.set(key, { expires: Date.now() + 60_000, value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

export function publicSlide(slide: StoredSlide): PathologySlide {
  const { slideId, label, stain, accession, sourceFileName, sourceUri, sourceBytes, sourceSha256,
    width, height, tileSize, overlap, maxLevel, tileCount, mppX, mppY, objectivePower, scanner, scanDate, colorProfile } = slide;
  return { slideId, label, stain, accession, sourceFileName, sourceUri, sourceBytes, sourceSha256,
    width, height, tileSize, overlap, maxLevel, tileCount, mppX, mppY, objectivePower, scanner, scanDate, colorProfile };
}

export function tileEntry(manifest: TileManifest, level: number, x: number, y: number) {
  if (![level, x, y].every(Number.isSafeInteger) || level < 0 || level > manifest.maxLevel || x < 0 || y < 0) return null;
  const downsample = 2 ** (manifest.maxLevel - level);
  if (x >= Math.ceil(Math.ceil(manifest.width / downsample) / manifest.tileSize)
    || y >= Math.ceil(Math.ceil(manifest.height / downsample) / manifest.tileSize)) return null;
  const entry = manifest.tiles[`${level}/${x}_${y}`];
  if (!entry) return null;
  const [packIndex, offset, length] = entry;
  const pack = manifest.packs[packIndex];
  if (!pack || ![packIndex, offset, length].every(Number.isSafeInteger) || offset < 0 || length <= 0
    || length > 16 * 1024 * 1024 || offset + length > pack.sizeBytes) throw new Error("Invalid tile range");
  return { url: validBlobUrl(pack.url), offset, length };
}

async function loadManifest(slide: StoredSlide, signal: AbortSignal) {
  return cached(manifestCache, slide.tileManifestSha256, async () => {
    const response = await fetch(validBlobUrl(slide.tileManifestUrl), { redirect: "error", signal });
    if (!response.ok) throw new Error("Slide tile index unavailable");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 16 * 1024 * 1024 || createHash("sha256").update(new Uint8Array(bytes)).digest("hex") !== slide.tileManifestSha256) {
      throw new Error("Slide tile index integrity check failed");
    }
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as TileManifest;
    if (manifest.version !== 1 || manifest.slideId !== slide.slideId || manifest.sourceSha256 !== slide.sourceSha256
      || manifest.width !== slide.width || manifest.height !== slide.height || manifest.maxLevel !== slide.maxLevel
      || manifest.tileSize !== slide.tileSize || manifest.overlap !== slide.overlap || !Array.isArray(manifest.packs)
      || typeof manifest.tiles !== "object" || !manifest.tiles) throw new Error("Slide tile index identity mismatch");
    return manifest;
  });
}

/** Caller enforces the wiki's password gate before dispatch, including every tile. */
export async function handlePathologyRequest(request: Request, client: ConvexHttpClient, siteSlug: string) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === "/api/pathology/slides") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
      const slides = await client.query(api.pathology.list, { siteSlug });
      return Response.json({ slides: slides.map(publicSlide) }, { headers });
    }
    const match = /^\/api\/pathology\/slides\/(he-[a-f0-9]{20})\/(thumbnail|regions|tiles\/(\d+)\/(\d+)_(\d+)\.jpg)$/.exec(path);
    if (!match) return Response.json({ error: "Slide resource not found" }, { status: 404, headers });
    const slideId = match[1];
    const slide = await cached(slideCache, `${siteSlug}:${slideId}`, () => client.query(api.pathology.get, { siteSlug, slideId }));
    if (!slide) return Response.json({ error: "Slide not found" }, { status: 404, headers });
    if (match[2] === "regions") {
      if (request.method === "GET") {
        const row = await client.query(api.pathology.regions, { siteSlug, slideId });
        return Response.json({ regions: row?.regions ?? [], version: row?.version ?? 0 }, { headers });
      }
      if (request.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
      if (request.headers.get("origin") && request.headers.get("origin") !== url.origin) return Response.json({ error: "Origin mismatch" }, { status: 403, headers });
      if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON required" }, { status: 415, headers });
      const text = await request.text();
      if (text.length > 1_000_000) return Response.json({ error: "Notes too large" }, { status: 413, headers });
      let body: { regions: PathologyRegion[]; sourceSha256: string; expectedVersion: number };
      try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers }); }
      if (!Array.isArray(body.regions) || body.regions.length > 200 || !Number.isSafeInteger(body.expectedVersion)
        || body.expectedVersion < 0 || body.sourceSha256 !== slide.sourceSha256) {
        return Response.json({ error: "Invalid slide notes" }, { status: 400, headers });
      }
      const result = await client.mutation(api.pathology.saveRegions, { siteSlug, slideId,
        sourceSha256: body.sourceSha256, expectedVersion: body.expectedVersion, regions: body.regions }, { skipQueue: true });
      return Response.json(result, { status: result.conflict ? 409 : 200, headers });
    }
    if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
    if (match[2] === "thumbnail") {
      const response = await fetch(validBlobUrl(slide.thumbnailUrl), { redirect: "error", signal });
      if (!response.ok) throw new Error("Slide overview unavailable");
      return new Response(response.body, { headers: { ...headers, "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" } });
    }
    const manifest = await loadManifest(slide, signal);
    const entry = tileEntry(manifest, Number(match[3]), Number(match[4]), Number(match[5]));
    if (!entry) return Response.json({ error: "Tile not found" }, { status: 404, headers });
    const end = entry.offset + entry.length - 1;
    const response = await fetch(entry.url, { headers: { Range: `bytes=${entry.offset}-${end}` }, redirect: "error", signal });
    if (response.status !== 206 || !response.headers.get("content-range")?.startsWith(`bytes ${entry.offset}-${end}/`)) {
      await response.body?.cancel();
      throw new Error("Storage did not return the exact tile range");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== entry.length) throw new Error("Truncated slide tile");
    return new Response(bytes, { headers: { ...headers, "Content-Type": "image/jpeg", "Content-Length": String(entry.length), "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    console.warn("[pathology] Slide resource unavailable", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Slide resource unavailable. Please retry." }, { status: 503, headers });
  }
}
