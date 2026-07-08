/**
 * Durable workflow for building and caching the wiki download zips.
 *
 * Triggered as a child of postDeployWorkflow so the first real user request
 * always hits the fast path (307 → CDN). Falls back to retry on failure —
 * unlike after(), a failed workflow retries automatically.
 *
 * Usage:
 *   import { start } from "workflow/api";
 *   import { buildDownloadCacheWorkflow } from "@/workflows/build-download-cache";
 *   await start(buildDownloadCacheWorkflow, [type]);
 */

import { FatalError, RetryableError } from "workflow";

export type DownloadType = "full" | "markdown";

const BLOB_NAMES_BY_SITE = (siteSlug: string) =>
  siteSlug === "diana"
    ? ({
        full: "diana-tnbc-wiki-full.zip",
        markdown: "diana-tnbc-wiki-markdown.zip",
      } as const)
    : ({
        full: `${siteSlug}-wiki-full.zip`,
        markdown: `${siteSlug}-wiki-markdown.zip`,
      } as const);

const ASSET_BATCH_TARGET_BYTES = 64 * 1024 * 1024;
const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
const ZIP_MAX_UINT32 = 0xffffffff;
const ZIP_MAX_UINT16 = 0xffff;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const DEFAULT_DOS_TIME = 0;
const DEFAULT_DOS_DATE = 0x5821; // 2024-01-01

interface ArchiveAsset {
  path: string;
  blobUrl: string;
  sizeBytes?: number | null;
}

interface ArchivePlan {
  assetBatches: ArchiveAsset[][];
}

interface MultipartUploadState {
  pathname: string;
  key: string;
  uploadId: string;
}

interface UploadedPart {
  etag: string;
  partNumber: number;
}

interface ZipEntryMetadata {
  name: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
}

interface ArchivePartResult {
  part: UploadedPart;
  entries: ZipEntryMetadata[];
  bytesUploaded: number;
}

// ─── steps (full Node.js access) ─────────────────────────────────────────────

async function getWorkflowSiteData(siteSlug: string) {
  const { siteDataFromSlug } = await import("@/lib/site-data");
  return siteDataFromSlug(siteSlug);
}

async function collectArchivePlan(
  type: DownloadType,
  siteSlug: string,
): Promise<ArchivePlan> {
  "use step";
  const siteData = await getWorkflowSiteData(siteSlug);

  if (type === "markdown") {
    return { assetBatches: [] };
  }

  const collected: ArchiveAsset[] = [];
  for (const fetchPage of [
    siteData.documents.listPdfAssetsPage,
    siteData.documents.listFileAssetsPage,
  ]) {
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const result = await fetchPage({ cursor, numItems: 500 });
      collected.push(...(result.page as ArchiveAsset[]));
      isDone = result.isDone;
      cursor = result.continueCursor;
      if (!isDone && !cursor) break;
    }
  }
  const assets = collected.sort(
    (a, b) => a.path.localeCompare(b.path),
  );
  console.log(
    `[download-cache] Binary assets in Convex: ${assets.length} site=${siteSlug}`,
  );
  return { assetBatches: batchArchiveAssets(assets) };
}

async function createArchiveUpload(
  type: DownloadType,
  siteSlug: string,
): Promise<MultipartUploadState> {
  "use step";
  const token =
    process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new FatalError("Blob write token not set");

  const pathname = BLOB_NAMES_BY_SITE(siteSlug)[type];
  const { createMultipartUpload } = await import("@vercel/blob");
  const upload = await createMultipartUpload(pathname, {
    access: "public",
    token,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/zip",
  });
  console.log(`[download-cache] Multipart upload created for ${pathname}`);
  return { pathname, ...upload };
}

async function uploadAssetArchivePart(
  upload: MultipartUploadState,
  batch: ArchiveAsset[],
  partNumber: number,
  startOffset: number,
): Promise<ArchivePartResult> {
  "use step";
  const token =
    process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new FatalError("Blob write token not set");

  const t0 = Date.now();
  const { body, entries } = await buildAssetLocalBlocks(batch, startOffset);
  if (body.byteLength < MIN_MULTIPART_PART_BYTES) {
    throw new RetryableError(
      `Asset archive part ${partNumber} is too small for non-final multipart upload`,
    );
  }

  const part = await uploadMultipartPart(upload, partNumber, body, token);
  console.log(
    `[download-cache] Asset part ${partNumber}: ${entries.length}/${batch.length} assets, ${(body.byteLength / 1024 / 1024).toFixed(1)} MB in ${Date.now() - t0}ms`,
  );
  return { part, entries, bytesUploaded: body.byteLength };
}

async function uploadFinalArchivePart(
  upload: MultipartUploadState,
  type: DownloadType,
  siteSlug: string,
  assetBatch: ArchiveAsset[],
  previousEntries: ZipEntryMetadata[],
  previousParts: UploadedPart[],
  partNumber: number,
  startOffset: number,
): Promise<string> {
  "use step";
  const token =
    process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new FatalError("Blob write token not set");

  const t0 = Date.now();
  const localBuffers: Buffer[] = [];
  const finalEntries: ZipEntryMetadata[] = [];
  let offset = startOffset;

  if (type === "full" && assetBatch.length > 0) {
    const assetBlocks = await buildAssetLocalBlocks(assetBatch, offset);
    localBuffers.push(assetBlocks.body);
    finalEntries.push(...assetBlocks.entries);
    offset += assetBlocks.body.byteLength;
  }

  const markdownBlocks = await buildMarkdownLocalBlocks(siteSlug, offset);
  localBuffers.push(markdownBlocks.body);
  finalEntries.push(...markdownBlocks.entries);
  offset += markdownBlocks.body.byteLength;

  const allEntries = [...previousEntries, ...finalEntries];
  const centralDirectory = buildCentralDirectory(allEntries, offset);
  const body = Buffer.concat([...localBuffers, centralDirectory]);
  const finalPart = await uploadMultipartPart(upload, partNumber, body, token);
  const parts = [...previousParts, finalPart].sort(
    (a, b) => a.partNumber - b.partNumber,
  );

  const { completeMultipartUpload } = await import("@vercel/blob");
  const result = await completeMultipartUpload(upload.pathname, parts, {
    access: "public",
    token,
    uploadId: upload.uploadId,
    key: upload.key,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/zip",
  });
  const totalBytes = offset + centralDirectory.byteLength;
  console.log(
    `[download-cache] Upload complete: ${allEntries.length} entries, ${(totalBytes / 1024 / 1024).toFixed(1)} MB in final step ${Date.now() - t0}ms -> ${result.url}`,
  );
  return result.url;
}

async function saveCache(
  type: DownloadType,
  url: string,
  siteSlug: string,
): Promise<void> {
  "use step";
  const siteData = await getWorkflowSiteData(siteSlug);

  const CACHE_KEYS = {
    full: "wiki-zip-cache",
    markdown: "wiki-zip-cache-markdown",
  } as const;

  const info = {
    url,
    builtAt: Date.now(),
    deployId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  };

  await siteData.documents.setMeta({
    key: CACHE_KEYS[type],
    value: JSON.stringify(info),
  });
  console.log(
    `[download-cache] Cache entry saved for type=${type} site=${siteSlug} deployId=${info.deployId}`,
  );
}

// ─── archive builders (called inside steps, full Node.js access) ──────────────

function batchArchiveAssets(assets: ArchiveAsset[]): ArchiveAsset[][] {
  const batches: ArchiveAsset[][] = [];
  let batch: ArchiveAsset[] = [];
  let batchBytes = 0;

  for (const asset of assets) {
    batch.push(asset);
    batchBytes += Math.max(0, Number(asset.sizeBytes ?? 0));
    if (batchBytes >= ASSET_BATCH_TARGET_BYTES) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

async function buildAssetLocalBlocks(batch: ArchiveAsset[], startOffset: number) {
  const buffers = await Promise.all(
    batch.map(async (asset) => {
      try {
        const res = await fetch(asset.blobUrl);
        if (!res.ok) {
          console.warn(
            `[download-cache] Failed to fetch asset ${asset.path}: ${res.status}`,
          );
          return null;
        }
        return {
          name: asset.path,
          data: Buffer.from(await res.arrayBuffer()),
        };
      } catch (err: unknown) {
        console.warn(`[download-cache] Failed to fetch asset ${asset.path}:`, err);
        return null;
      }
    }),
  );

  const items: NonNullable<(typeof buffers)[number]>[] = [];
  for (const item of buffers) {
    if (item) items.push(item);
  }

  return buildLocalBlocks(items, startOffset);
}

async function buildMarkdownLocalBlocks(siteSlug: string, startOffset: number) {
  const siteData = await getWorkflowSiteData(siteSlug);

  type ListPageResult = { page: Array<{ slug: string; content: string }>; isDone: boolean; continueCursor: string };
  let cursor: string | null = null;
  let isDone = false;
  let pageNum = 0;
  let totalDocs = 0;
  const { applyPiiRedactions } = await import("@/lib/pii-redaction");
  const items: Array<{ name: string; data: Buffer }> = [];

  while (!isDone) {
    const page = (await siteData.documents.listPageWithContent({
      cursor,
      numItems: 50,
    })) as ListPageResult;
    for (const doc of page.page) {
      if (doc.content) {
        const content = applyPiiRedactions(doc.content);
        items.push({
          name: `${doc.slug}.md`,
          data: Buffer.from(content, "utf-8"),
        });
        totalDocs++;
      }
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
    console.log(`[download-cache] Markdown page ${++pageNum}: ${page.page.length} docs (total=${totalDocs}, done=${isDone})`);
  }

  return buildLocalBlocks(items, startOffset);
}

function buildLocalBlocks(
  items: Array<{ name: string; data: Buffer }>,
  startOffset: number,
): { body: Buffer; entries: ZipEntryMetadata[] } {
  const buffers: Buffer[] = [];
  const entries: ZipEntryMetadata[] = [];
  let offset = startOffset;

  for (const item of items) {
    const name = normalizeZipEntryName(item.name);
    const crc = crc32(item.data);
    const localHeader = buildLocalFileHeader(name, item.data.byteLength, crc);

    entries.push({
      name,
      crc32: crc,
      compressedSize: item.data.byteLength,
      uncompressedSize: item.data.byteLength,
      localHeaderOffset: offset,
      dosTime: DEFAULT_DOS_TIME,
      dosDate: DEFAULT_DOS_DATE,
    });
    buffers.push(localHeader, item.data);
    offset += localHeader.byteLength + item.data.byteLength;
  }

  return { body: Buffer.concat(buffers), entries };
}

function normalizeZipEntryName(name: string) {
  return name.replace(/^\/+/, "").replaceAll("\\", "/");
}

function buildLocalFileHeader(name: string, size: number, crc: number) {
  assertZip32Size(size, "entry size");
  const nameBuffer = Buffer.from(name, "utf-8");
  assertZip16Size(nameBuffer.byteLength, "entry name length");

  const header = Buffer.alloc(30 + nameBuffer.byteLength);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  header.writeUInt16LE(ZIP_STORE_METHOD, 8);
  header.writeUInt16LE(DEFAULT_DOS_TIME, 10);
  header.writeUInt16LE(DEFAULT_DOS_DATE, 12);
  header.writeUInt32LE(crc >>> 0, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBuffer.byteLength, 26);
  header.writeUInt16LE(0, 28);
  nameBuffer.copy(header, 30);
  return header;
}

function buildCentralDirectory(entries: ZipEntryMetadata[], centralOffset: number) {
  assertZip16Size(entries.length, "ZIP entry count");
  assertZip32Size(centralOffset, "central directory offset");
  const records = entries.map(buildCentralDirectoryRecord);
  const centralSize = records.reduce((total, record) => total + record.byteLength, 0);
  assertZip32Size(centralSize, "central directory size");

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...records, end]);
}

function buildCentralDirectoryRecord(entry: ZipEntryMetadata) {
  assertZip32Size(entry.compressedSize, "compressed size");
  assertZip32Size(entry.uncompressedSize, "uncompressed size");
  assertZip32Size(entry.localHeaderOffset, "local header offset");
  const nameBuffer = Buffer.from(entry.name, "utf-8");
  assertZip16Size(nameBuffer.byteLength, "entry name length");

  const record = Buffer.alloc(46 + nameBuffer.byteLength);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  record.writeUInt16LE(ZIP_STORE_METHOD, 10);
  record.writeUInt16LE(entry.dosTime, 12);
  record.writeUInt16LE(entry.dosDate, 14);
  record.writeUInt32LE(entry.crc32 >>> 0, 16);
  record.writeUInt32LE(entry.compressedSize, 20);
  record.writeUInt32LE(entry.uncompressedSize, 24);
  record.writeUInt16LE(nameBuffer.byteLength, 28);
  record.writeUInt16LE(0, 30);
  record.writeUInt16LE(0, 32);
  record.writeUInt16LE(0, 34);
  record.writeUInt16LE(0, 36);
  record.writeUInt32LE(0, 38);
  record.writeUInt32LE(entry.localHeaderOffset, 42);
  nameBuffer.copy(record, 46);
  return record;
}

async function uploadMultipartPart(
  upload: MultipartUploadState,
  partNumber: number,
  body: Buffer,
  token: string,
): Promise<UploadedPart> {
  const { uploadPart } = await import("@vercel/blob");
  try {
    return await uploadPart(upload.pathname, body, {
      access: "public",
      token,
      uploadId: upload.uploadId,
      key: upload.key,
      partNumber,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/zip",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new RetryableError(`Part upload failed: ${msg}`);
  }
}

function assertZip16Size(value: number, label: string) {
  if (value > ZIP_MAX_UINT16) {
    throw new FatalError(`${label} exceeds ZIP32 limit`);
  }
}

function assertZip32Size(value: number, label: string) {
  if (value > ZIP_MAX_UINT32) {
    throw new FatalError(`${label} exceeds ZIP32 limit`);
  }
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC_TABLE.length; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── workflow orchestrator ────────────────────────────────────────────────────

export async function buildDownloadCacheWorkflow(
  type: DownloadType,
  siteSlug = "diana",
) {
  "use workflow";

  console.log(
    `[download-cache] Workflow started: type=${type} site=${siteSlug} deploy=${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`,
  );

  const plan = await collectArchivePlan(type, siteSlug);
  if (type === "full" && plan.assetBatches.length === 0) {
    console.log("[download-cache] No binary assets ingested yet — skipping full cache build");
    return;
  }

  const t0 = Date.now();
  const upload = await createArchiveUpload(type, siteSlug);
  const previousEntries: ZipEntryMetadata[] = [];
  const previousParts: UploadedPart[] = [];
  const assetBatchesToUpload =
    type === "full" ? plan.assetBatches.slice(0, -1) : [];
  const finalAssetBatch =
    type === "full" ? (plan.assetBatches.at(-1) ?? []) : [];
  let partNumber = 1;
  let offset = 0;

  for (const batch of assetBatchesToUpload) {
    const result = await uploadAssetArchivePart(
      upload,
      batch,
      partNumber,
      offset,
    );
    previousParts.push(result.part);
    previousEntries.push(...result.entries);
    offset += result.bytesUploaded;
    partNumber++;
    console.log(
      `[download-cache] Uploaded ${previousEntries.length} entries so far (${(offset / 1024 / 1024).toFixed(1)} MB)`,
    );
  }

  const url = await uploadFinalArchivePart(
    upload,
    type,
    siteSlug,
    finalAssetBatch,
    previousEntries,
    previousParts,
    partNumber,
    offset,
  );
  await saveCache(type, url, siteSlug);

  console.log(`[download-cache] Workflow complete: type=${type} in ${Date.now() - t0}ms`);
}
