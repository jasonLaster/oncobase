/**
 * Stateful ZIP builder with per-file compression caching.
 *
 * Each file is compressed once (zlib deflateRaw) and the compressed bytes
 * are stored in Vercel Blob, keyed by content hash. On subsequent builds,
 * unchanged files are fetched from the cache instead of being re-compressed.
 *
 * This means a markdown-only edit costs only the changed markdown files —
 * the PDFs (which almost never change) are free cache hits.
 *
 * ZIP format reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 */

import zlib from "zlib";
import { promisify } from "util";

const deflateRaw = promisify(zlib.deflateRaw);

// ─── CRC-32 ───────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── ZIP binary format ────────────────────────────────────────────────────────

function localHeader(name: Buffer, compressedSize: number, uncompressedSize: number, crc: number): Buffer {
  const h = Buffer.alloc(30 + name.length);
  h.writeUInt32LE(0x04034b50, 0);   // PK\x03\x04
  h.writeUInt16LE(20, 4);            // version needed: 2.0
  h.writeUInt16LE(0, 6);             // flags
  h.writeUInt16LE(8, 8);             // compression: DEFLATE
  h.writeUInt16LE(0, 10);            // mod time
  h.writeUInt16LE(0, 12);            // mod date
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(compressedSize, 18);
  h.writeUInt32LE(uncompressedSize, 22);
  h.writeUInt16LE(name.length, 26);
  h.writeUInt16LE(0, 28);            // extra field length
  name.copy(h, 30);
  return h;
}

function centralDirEntry(name: Buffer, compressedSize: number, uncompressedSize: number, crc: number, offset: number): Buffer {
  const e = Buffer.alloc(46 + name.length);
  e.writeUInt32LE(0x02014b50, 0);   // PK\x01\x02
  e.writeUInt16LE(20, 4);            // version made by
  e.writeUInt16LE(20, 6);            // version needed
  e.writeUInt16LE(0, 8);             // flags
  e.writeUInt16LE(8, 10);            // compression: DEFLATE
  e.writeUInt16LE(0, 12);            // mod time
  e.writeUInt16LE(0, 14);            // mod date
  e.writeUInt32LE(crc, 16);
  e.writeUInt32LE(compressedSize, 20);
  e.writeUInt32LE(uncompressedSize, 24);
  e.writeUInt16LE(name.length, 28);
  e.writeUInt16LE(0, 30);            // extra field length
  e.writeUInt16LE(0, 32);            // comment length
  e.writeUInt16LE(0, 34);            // disk number start
  e.writeUInt16LE(0, 36);            // internal attrs
  e.writeUInt32LE(0, 38);            // external attrs
  e.writeUInt32LE(offset, 42);
  name.copy(e, 46);
  return e;
}

function endOfCentralDir(count: number, cdSize: number, cdOffset: number): Buffer {
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);   // PK\x05\x06
  e.writeUInt16LE(0, 4);             // disk number
  e.writeUInt16LE(0, 6);             // CD disk start
  e.writeUInt16LE(count, 8);         // entries on disk
  e.writeUInt16LE(count, 10);        // total entries
  e.writeUInt32LE(cdSize, 12);
  e.writeUInt32LE(cdOffset, 16);
  e.writeUInt16LE(0, 20);            // comment length
  return e;
}

// ─── Entry cache metadata ─────────────────────────────────────────────────────

interface EntryCacheMeta {
  blobUrl: string;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
}

function cacheKey(contentHash: string): string {
  return `zip-entry-cache:${contentHash}`;
}

// ─── StatefulZipBuilder ───────────────────────────────────────────────────────

interface FileEntry {
  name: Buffer;
  compressedData: Buffer;
  uncompressedSize: number;
  crc: number;
}

export interface BuildStats {
  totalFiles: number;
  cacheHits: number;
  cacheMisses: number;
  totalBytes: number;
  compressedBytes: number;
  elapsedMs: number;
}

type ConvexApi = Awaited<ReturnType<typeof import("./stateful-zip-builder").getConvexHelpers>>;

/** Call this once to get fetchQuery/fetchMutation bound to the current request. */
export async function getConvexHelpers() {
  const { fetchQuery, fetchMutation } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");
  return { fetchQuery, fetchMutation, api };
}

export class StatefulZipBuilder {
  private entries: FileEntry[] = [];
  private stats = { hits: 0, misses: 0, totalUncompressed: 0, compressedBytes: 0 };
  private t0 = Date.now();

  /**
   * Add a file to the archive.
   *
   * If `contentHash` is provided and a cached compressed entry exists in Blob,
   * the cached bytes are used (cache hit). Otherwise the content is compressed,
   * cached, and added (cache miss).
   */
  async addFile(
    name: string,
    content: Buffer,
    contentHash: string,
    convex: ConvexApi,
    blobToken: string
  ): Promise<"hit" | "miss"> {
    const nameBuf = Buffer.from(name, "utf-8");
    const cacheMetaRaw = await convex.fetchQuery(convex.api.documents.getMeta, {
      key: cacheKey(contentHash),
    }).catch(() => null);

    if (cacheMetaRaw) {
      const meta = JSON.parse(cacheMetaRaw) as EntryCacheMeta;
      try {
        const { get } = await import("@vercel/blob");
        const blobResult = await get(meta.blobUrl, { token: blobToken, access: "private" });
        if (blobResult?.stream) {
          const chunks: Buffer[] = [];
          const reader = blobResult.stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value));
          }
          const compressedData = Buffer.concat(chunks);
          this.entries.push({ name: nameBuf, compressedData, uncompressedSize: meta.uncompressedSize, crc: meta.crc32 });
          this.stats.hits++;
          this.stats.totalUncompressed += meta.uncompressedSize;
          this.stats.compressedBytes += meta.compressedSize;
          return "hit";
        }
      } catch {
        // Cache entry corrupt or blob gone — fall through to recompute
      }
    }

    // Cache miss: compress and store
    const compressedData = await deflateRaw(content) as Buffer;
    const crc = crc32(content);

    const { put } = await import("@vercel/blob");
    const blob = await put(`zip-entries/${contentHash}`, compressedData, {
      access: "private",
      token: blobToken,
      allowOverwrite: true,
    });

    const meta: EntryCacheMeta = {
      blobUrl: blob.url,
      compressedSize: compressedData.length,
      uncompressedSize: content.length,
      crc32: crc,
    };
    await convex.fetchMutation(convex.api.documents.setMeta, {
      key: cacheKey(contentHash),
      value: JSON.stringify(meta),
    }).catch((err: unknown) => console.warn(`[zip-builder] Failed to save entry cache for ${name}:`, err));

    this.entries.push({ name: nameBuf, compressedData, uncompressedSize: content.length, crc });
    this.stats.misses++;
    this.stats.totalUncompressed += content.length;
    this.stats.compressedBytes += compressedData.length;
    return "miss";
  }

  /** Assemble the final ZIP buffer from all added entries. */
  finalize(): { zip: Buffer; stats: BuildStats } {
    const parts: Buffer[] = [];
    const cdEntries: Buffer[] = [];
    let offset = 0;

    for (const entry of this.entries) {
      const header = localHeader(entry.name, entry.compressedData.length, entry.uncompressedSize, entry.crc);
      cdEntries.push(centralDirEntry(entry.name, entry.compressedData.length, entry.uncompressedSize, entry.crc, offset));
      parts.push(header, entry.compressedData);
      offset += header.length + entry.compressedData.length;
    }

    const cdBuf = Buffer.concat(cdEntries);
    const eocd = endOfCentralDir(this.entries.length, cdBuf.length, offset);
    parts.push(cdBuf, eocd);

    const zip = Buffer.concat(parts);
    const stats: BuildStats = {
      totalFiles: this.entries.length,
      cacheHits: this.stats.hits,
      cacheMisses: this.stats.misses,
      totalBytes: this.stats.totalUncompressed,
      compressedBytes: this.stats.compressedBytes,
      elapsedMs: Date.now() - this.t0,
    };
    return { zip, stats };
  }
}
