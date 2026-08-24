import "./load-env";

import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";
import {
  siteCreateMultipartUploader,
  siteHead,
  sitePut,
} from "../src/lib/blob";
import { resolveServerConvexUrl } from "../src/lib/convex-url";

const SITE_SLUG = argValue("--site") ?? "diana";
const SOURCE = requiredArg("--source");
const ASSET_PATH = requiredArg("--path").replace(/^\/+/, "");
const CONTENT_TYPE = argValue("--content-type") ?? "application/octet-stream";
const OWNER_SLUGS = argValues("--owner-slug");
const SENSITIVE = process.argv.includes("--sensitive");
const ALLOW_OVERWRITE = process.argv.includes("--allow-overwrite");
const DRY_RUN = process.argv.includes("--dry-run");
const PART_BYTES = 64 * 1024 * 1024;

async function sha256File(path: string) {
  const file = await open(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  return hash.digest("hex");
}

async function uploadMultipart(sizeBytes: number) {
  const uploader = await siteCreateMultipartUploader(SITE_SLUG, `files/${ASSET_PATH}`, {
    addRandomSuffix: false,
    allowOverwrite: ALLOW_OVERWRITE,
    contentType: CONTENT_TYPE,
  });
  const file = await open(SOURCE, "r");
  const parts = [];
  try {
    let offset = 0;
    let partNumber = 1;
    while (offset < sizeBytes) {
      const length = Math.min(PART_BYTES, sizeBytes - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      if (bytesRead !== length) {
        throw new Error(`Short read at offset ${offset}: ${bytesRead}/${length}`);
      }
      parts.push(await uploader.uploadPart(partNumber, buffer));
      offset += bytesRead;
      console.log(
        `Uploaded part ${partNumber}: ${offset}/${sizeBytes} bytes (${((offset / sizeBytes) * 100).toFixed(1)}%)`,
      );
      partNumber += 1;
    }
  } finally {
    await file.close();
  }
  return uploader.complete(parts);
}

async function main() {
  const sourceStat = await stat(SOURCE);
  if (!sourceStat.isFile()) throw new Error(`Not a file: ${SOURCE}`);
  const sizeBytes = sourceStat.size;
  const contentHash = await sha256File(SOURCE);
  console.log(
    JSON.stringify({ source: SOURCE, path: ASSET_PATH, sizeBytes, contentHash, dryRun: DRY_RUN }),
  );
  if (DRY_RUN) return;

  const blob =
    sizeBytes >= PART_BYTES
      ? await uploadMultipart(sizeBytes)
      : await sitePut(SITE_SLUG, `files/${ASSET_PATH}`, Bun.file(SOURCE), {
          addRandomSuffix: false,
          allowOverwrite: ALLOW_OVERWRITE,
          contentType: CONTENT_TYPE,
        });
  const remote = await siteHead(SITE_SLUG, `files/${ASSET_PATH}`);
  if (remote.size !== sizeBytes) {
    throw new Error(`Blob size mismatch: local=${sizeBytes}, remote=${remote.size}`);
  }

  const convexUrl = resolveServerConvexUrl();
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required.");
  const convex = new ConvexHttpClient(convexUrl);
  await convex.mutation(api.documents.upsertFileAsset, {
    siteSlug: SITE_SLUG,
    path: ASSET_PATH,
    blobUrl: blob.url,
    sizeBytes,
    contentHash,
    ownerSlugs: OWNER_SLUGS,
    sensitive: SENSITIVE,
    sensitiveInclude: [],
    visibilityHash: createHash("sha256")
      .update(JSON.stringify({ ownerSlugs: [...OWNER_SLUGS].sort(), sensitive: SENSITIVE }))
      .digest("hex"),
  });
  console.log(
    JSON.stringify({ registered: true, path: ASSET_PATH, sizeBytes, contentHash }),
  );
}

function requiredArg(name: string) {
  const value = argValue(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argValues(name: string) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
