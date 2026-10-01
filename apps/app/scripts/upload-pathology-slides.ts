import "./load-env";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBackendClient } from "../server/backend-client";
import { api } from "../convex/_generated/api";
import { sitePut, siteHead } from "../server/blob";
import type { PathologySlide } from "@oncobase/diagnostics/pathology/model";
import type { TileManifest } from "../server/pathology-api";

const input = process.argv[process.argv.indexOf("--source") + 1];
const siteSlug = process.argv.includes("--site") ? process.argv[process.argv.indexOf("--site") + 1] : "diana";
const dryRun = process.argv.includes("--dry-run");
if (!process.argv.includes("--source") || !input) throw new Error("Usage: bun scripts/upload-pathology-slides.ts --source prepared-directory [--site diana] [--dry-run]");
const convex = createBackendClient();
if (process.env.CONVEX_DEPLOY_KEY) {
  (convex as unknown as { setAdminAuth(key: string, identity: Record<string, string>): void }).setAdminAuth(process.env.CONVEX_DEPLOY_KEY,
    { issuer: "https://oncobase.app/backend", subject: "wiki-application-server", role: "backend-service" });
}

async function uploadVerified(directory: string, file: string, key: string, contentType: string, expectedSha?: string) {
  const bytes = await readFile(path.join(directory, file));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha && expectedSha !== hash) throw new Error(`Local checksum mismatch: ${file}`);
  let remote;
  try { remote = await siteHead(siteSlug, key); } catch { /* Missing upload can be created. */ }
  if (remote && remote.size !== bytes.length) throw new Error(`Existing immutable upload has a different size: ${file}`);
  if (!remote) {
    await sitePut(siteSlug, key, bytes, { addRandomSuffix: false, contentType, multipart: bytes.length >= 8 * 1024 * 1024 });
    remote = await siteHead(siteSlug, key);
  }
  if (remote.size !== bytes.length) throw new Error(`Uploaded size mismatch: ${file}`);
  // Compare a bounded remote sample to local bytes before catalog registration.
  const end = Math.min(bytes.length, 4096) - 1;
  const sample = await fetch(remote.url, { headers: { Range: `bytes=0-${end}` }, signal: AbortSignal.timeout(30_000) });
  if (sample.status !== 206 || !Buffer.from(await sample.arrayBuffer()).equals(bytes.subarray(0, end + 1))) throw new Error(`Remote sample mismatch: ${file}`);
  return { url: remote.url, sha256: hash };
}

for (const name of (await readdir(input)).sort()) {
  const directory = path.join(input, name);
  if (!/^he-[a-f0-9]{20}$/.test(name)) continue;
  const slide = JSON.parse(await readFile(path.join(directory, "prepared.json"), "utf8")) as PathologySlide;
  const manifest = JSON.parse(await readFile(path.join(directory, "tiles.json"), "utf8")) as Omit<TileManifest, "packs"> & { packs: Array<{ file: string; url: string; sizeBytes: number; sha256: string }> };
  if (slide.slideId !== name || manifest.slideId !== name || Object.keys(manifest.tiles).length !== slide.tileCount) throw new Error("Prepared slide identity/count mismatch");
  console.log(JSON.stringify({ slideId: name, width: slide.width, height: slide.height, tileCount: slide.tileCount, packs: manifest.packs.length, dryRun }));
  if (dryRun) continue;
  const prefix = `pathology/${name}/${slide.sourceSha256}/v1`;
  // Bounded upload parallelism; each pack is at most 64 MiB.
  for (let offset = 0; offset < manifest.packs.length; offset += 3) {
    await Promise.all(manifest.packs.slice(offset, offset + 3).map(async pack => {
      const result = await uploadVerified(directory, pack.file, `${prefix}/${pack.sha256}.bin`, "application/octet-stream", pack.sha256);
      pack.url = result.url;
    }));
    console.log(`${name}: uploaded ${Math.min(offset + 3, manifest.packs.length)}/${manifest.packs.length} packs`);
  }
  const thumbnail = await uploadVerified(directory, "thumbnail.jpg", `${prefix}/thumbnail.jpg`, "image/jpeg");
  const uploadManifest = { ...manifest, packs: manifest.packs.map(({ url, sizeBytes, sha256 }) => ({ url, sizeBytes, sha256 })) };
  const manifestBytes = Buffer.from(JSON.stringify(uploadManifest));
  const manifestSha = createHash("sha256").update(manifestBytes).digest("hex");
  await writeFile(path.join(directory, "uploaded-tiles.json"), manifestBytes);
  const index = await uploadVerified(directory, "uploaded-tiles.json", `${prefix}/${manifestSha}.json`, "application/json", manifestSha);
  await convex.mutation(api.pathology.upsert, {
    siteSlug, slide: { ...slide, tileManifestUrl: index.url, tileManifestSha256: index.sha256, thumbnailUrl: thumbnail.url },
  });
  await writeFile(path.join(directory, "registered.json"), JSON.stringify({ siteSlug, slideId: name, manifestSha, registeredAt: new Date().toISOString() }, null, 2));
  console.log(`Registered ${name} in Convex for ${siteSlug}`);
}
