import type { ReaderStorePath } from "../../shared/reader-telemetry";

// LiveStore's fast path reads the leader's persisted state database straight
// from OPFS on the page thread, instead of waiting for the leader worker to
// boot and export it. The leader may be writing that file at the same moment
// (another tab, or the previous document's worker during a reload), and its
// worker can be killed mid-transaction. This guard returns an image only when
// it is provably a committed SQLite state; on any doubt it returns undefined,
// and the adapter asks the leader for a recreated snapshot instead.
//
// Storage layout (@livestore/sqlite-wasm AccessHandlePoolVFS): a flat OPFS
// directory of randomly named pool files. Each starts with a 4096-byte header
// naming the SQLite file it holds (path, open flags, cyrb53-style digest); the
// SQLite bytes follow. The leader uses the default rollback journal (DELETE
// mode, normal locking): before changing any database page SQLite creates and
// fills `<db>-journal`, and the transaction commits when that journal is
// deleted, which the VFS does by clearing its pool header. So:
//
// 1. No journal before, between and after two full reads, plus
// 2. identical bytes from both reads, plus
// 3. a self-consistent SQLite header (page size, page count == file size)
//
// means no transaction's page writes overlapped the first read: a write phase
// lies strictly inside its journal's lifetime, which would then have to start
// and end between the first two journal checks, so the second read would see
// the new pages and differ. A journal left by a killed worker (a hot journal
// the leader rolls back on open) is always rejected.

const SECTOR_SIZE = 4096;
const HEADER_MAX_PATH_SIZE = 512;
const HEADER_CORPUS_SIZE = HEADER_MAX_PATH_SIZE + 4;
const HEADER_DIGEST_SIZE = 8;
const SQLITE_MAGIC = "SQLite format 3\0";

/** The subset of OPFS handles the guard needs; tests provide an in-memory model. */
export type PoolFileHandle = { kind: string; getFile(): Promise<Blob> };
export type PoolDirectory = { values(): AsyncIterable<PoolFileHandle | { kind: string }> };
export type FastPathTarget = { directory: string; fileName: string };
export type FastPathResult = { snapshot: Uint8Array | undefined; path: ReaderStorePath };

type PoolEntry = { path: string } | { corrupt: true };

// Mirrors AccessHandlePoolVFS#computeDigest.
function computeDigest(corpus: Uint8Array) {
  if (!corpus[0]) return [0xfe_cc_5f_80, 0xac_ce_c0_37];
  let h1 = 0xde_ad_be_ef;
  let h2 = 0x41_c6_ce_57;
  for (const value of corpus) {
    h1 = Math.imul(h1 ^ value, 2_654_435_761);
    h2 = Math.imul(h2 ^ value, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  return [h1 >>> 0, h2 >>> 0];
}

/** Decodes a pool header. A header with a path but a bad digest is mid-rewrite. */
export function decodePoolHeader(header: Uint8Array): PoolEntry {
  if (header.byteLength < HEADER_CORPUS_SIZE + HEADER_DIGEST_SIZE) return header[0] ? { corrupt: true } : { path: "" };
  const corpus = header.subarray(0, HEADER_CORPUS_SIZE);
  const stored = new DataView(header.buffer, header.byteOffset + HEADER_CORPUS_SIZE, HEADER_DIGEST_SIZE);
  // The VFS writes the digest as a host-endian Uint32Array (little-endian on the web).
  const [d1, d2] = computeDigest(corpus);
  if (stored.getUint32(0, true) !== d1 || stored.getUint32(4, true) !== d2) return corpus[0] ? { corrupt: true } : { path: "" };
  const end = corpus.indexOf(0);
  return { path: new TextDecoder().decode(corpus.subarray(0, end < 0 ? HEADER_MAX_PATH_SIZE : end)) };
}

/** Header-level validation of a complete rollback-journal SQLite image. */
export function isCompleteSqliteImage(image: Uint8Array) {
  if (image.byteLength < 512) return false;
  for (let index = 0; index < SQLITE_MAGIC.length; index++) {
    if (image[index] !== SQLITE_MAGIC.charCodeAt(index)) return false;
  }
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const rawPageSize = view.getUint16(16);
  const pageSize = rawPageSize === 1 ? 65_536 : rawPageSize;
  if (pageSize < 512 || pageSize > 65_536 || (pageSize & (pageSize - 1)) !== 0) return false;
  // File format versions 1/1 mean rollback journal. WAL (2) keeps committed
  // pages outside this file, so the file alone is not a snapshot.
  if (image[18] !== 1 || image[19] !== 1) return false;
  if (image[21] !== 64 || image[22] !== 32 || image[23] !== 32) return false;
  // The in-header page count is valid only when "version-valid-for" matches
  // the change counter; then it must describe exactly this many bytes.
  const changeCounter = view.getUint32(24);
  const pageCount = view.getUint32(28);
  if (view.getUint32(92) !== changeCounter || pageCount === 0) return false;
  if (image.byteLength !== pageCount * pageSize) return false;
  // Page 1 holds the schema table's b-tree root: a table leaf or interior page.
  return image[100] === 0x0d || image[100] === 0x05;
}

// Both images come from fresh ArrayBuffers (offset 0); the first was validated
// as whole pages, so equal lengths are multiples of 4 bytes.
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) return false;
  const wa = new Int32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
  const wb = new Int32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  for (let index = 0; index < wa.length; index++) if (wa[index] !== wb[index]) return false;
  return true;
}

type Scan = { db: PoolFileHandle | undefined; busy: boolean };

// The pool's file set is fixed while a leader runs: SQLite files (db, journal)
// are associated with existing pool files, and the VFS only adds files when a
// brand-new directory has none (no database yet). List it once.
async function listPool(directory: PoolDirectory) {
  const files: PoolFileHandle[] = [];
  for await (const entry of directory.values()) if (entry.kind === "file") files.push(entry as PoolFileHandle);
  return files;
}

async function scan(files: PoolFileHandle[], fileName: string): Promise<Scan> {
  const entries = await Promise.all(files.map(async handle => {
    const file = await handle.getFile();
    return { handle, entry: decodePoolHeader(new Uint8Array(await file.slice(0, HEADER_CORPUS_SIZE + HEADER_DIGEST_SIZE).arrayBuffer())) };
  }));
  let db: PoolFileHandle | undefined;
  let busy = false;
  for (const { handle, entry } of entries) {
    if ("corrupt" in entry) busy = true;
    else if (entry.path === fileName) db = handle;
    // Any journal for this database, even empty, means a transaction is open
    // or was interrupted (hot). A WAL file means pages live outside the db.
    else if (entry.path === `${fileName}-journal` || entry.path === `${fileName}-wal`) busy = true;
  }
  return { db, busy };
}

async function readImage(handle: PoolFileHandle) {
  const file = await handle.getFile();
  return new Uint8Array(await file.slice(SECTOR_SIZE).arrayBuffer());
}

/** Never throws: every failure is a classified fallback to the leader snapshot. */
export async function readGuardedSnapshot(directory: PoolDirectory, fileName: string): Promise<FastPathResult> {
  const fallback = (path: ReaderStorePath): FastPathResult => ({ snapshot: undefined, path });
  try {
    const files = await listPool(directory);
    const before = await scan(files, fileName);
    if (before.busy) return fallback("fallback-journal");
    // No local state yet (first visit, new schema hash): the leader builds it.
    if (!before.db) return fallback("leader");
    const first = await readImage(before.db);
    if (first.byteLength === 0) return fallback("leader");
    if (!isCompleteSqliteImage(first)) return fallback("fallback-invalid");
    const between = await scan(files, fileName);
    if (between.busy) return fallback("fallback-journal");
    if (!between.db) return fallback("fallback-changed");
    const second = await readImage(between.db);
    if (!sameBytes(first, second)) return fallback("fallback-changed");
    const after = await scan(files, fileName);
    if (after.busy) return fallback("fallback-journal");
    if (!after.db) return fallback("fallback-changed");
    return { snapshot: first, path: "fast" };
  } catch (error) {
    // A File snapshot read after a concurrent write, or a pool file retired
    // underneath us, is a change rather than an unexplained storage error.
    const name = error instanceof DOMException ? error.name : "";
    return fallback(name === "NotReadableError" || name === "NotFoundError" ? "fallback-changed" : "fallback-error");
  }
}

/** The adapter's OPFS directory (never nested); missing means no local state. */
export async function openPoolDirectory(root: Promise<FileSystemDirectoryHandle>, directory: string): Promise<PoolDirectory | undefined> {
  try {
    return await (await root).getDirectoryHandle(directory) as unknown as PoolDirectory;
  } catch {
    return undefined;
  }
}

/**
 * The `experimental.fastPathSnapshot` hook for the patched persisted adapter.
 * Reports the chosen path (and how long the guarded read took) via `report`.
 */
export function makeFastPathSnapshotReader(
  root: Promise<FileSystemDirectoryHandle>,
  report: (path: ReaderStorePath, startMs: number, durationMs: number) => void,
) {
  return async ({ directory, fileName }: FastPathTarget): Promise<Uint8Array | undefined> => {
    const start = performance.now();
    const pool = await openPoolDirectory(root, directory);
    const result = pool ? await readGuardedSnapshot(pool, fileName) : { snapshot: undefined, path: "leader" as const };
    try { report(result.path, start, performance.now() - start); } catch { /* Diagnostics never affect boot. */ }
    return result.snapshot;
  };
}
