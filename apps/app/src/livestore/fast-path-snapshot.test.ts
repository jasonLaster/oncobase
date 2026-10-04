import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
// The real decoder used by LiveStore's own (unguarded) fast path, to prove the
// test's pool-file encoding and the guard's decoder match the VFS format.
import { decodeSAHPoolFilename } from "../../../../node_modules/@livestore/sqlite-wasm/dist/browser/opfs/opfs-sah-pool.js";
import { decodePoolHeader, isCompleteSqliteImage, makeFastPathSnapshotReader, readGuardedSnapshot, type PoolDirectory } from "./fast-path-snapshot";

const DB = "/state123.db";
const SQLITE_OPEN_MAIN_DB = 0x100;
const SQLITE_OPEN_MAIN_JOURNAL = 0x800;
const PAGE = 4096;

// Mirrors AccessHandlePoolVFS#setAssociatedPath: path, flags, digest, then data at 4096.
function digest(corpus: Uint8Array) {
  if (!corpus[0]) return new Uint32Array([0xfe_cc_5f_80, 0xac_ce_c0_37]);
  let h1 = 0xde_ad_be_ef, h2 = 0x41_c6_ce_57;
  for (const value of corpus) { h1 = Math.imul(h1 ^ value, 2_654_435_761); h2 = Math.imul(h2 ^ value, 1_597_334_677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  return new Uint32Array([h1 >>> 0, h2 >>> 0]);
}
function poolFile(path: string, flags: number, data: Uint8Array = new Uint8Array()) {
  const bytes = new Uint8Array(PAGE + data.byteLength);
  const corpus = bytes.subarray(0, 516);
  new TextEncoder().encodeInto(path, corpus);
  new DataView(bytes.buffer).setUint32(512, path ? flags : 0);
  bytes.set(new Uint8Array(digest(corpus).buffer), 516);
  bytes.set(data, PAGE);
  return bytes;
}
const dbFile = (image: Uint8Array) => poolFile(DB, SQLITE_OPEN_MAIN_DB, image);
const journalFile = () => poolFile(`${DB}-journal`, SQLITE_OPEN_MAIN_JOURNAL, new Uint8Array(PAGE).fill(7));
const unassociated = () => poolFile("", 0);

/**
 * An OPFS pool directory whose contents follow a script. Every getFile() takes
 * the next step: `files[n]` is the directory state seen by the n-th getFile
 * (File objects are snapshots, as in browsers). This models a leader writing
 * between, or during, the guard's individual reads deterministically.
 */
function scriptedPool(states: Uint8Array<ArrayBuffer>[][]) {
  let step = 0;
  const reads: number[] = [];
  const directory: PoolDirectory = {
    async *values() {
      const count = states[Math.min(step, states.length - 1)]!.length;
      for (let index = 0; index < count; index++) {
        yield { kind: "file", getFile: async () => {
          const state = states[Math.min(step++, states.length - 1)]!;
          reads.push(step);
          return new Blob([state[index] ?? unassociated()]);
        } };
      }
    },
  };
  return { directory, reads };
}
const stable = (files: Uint8Array<ArrayBuffer>[]) => scriptedPool([files]).directory;

function makeImages() {
  const db = new Database(":memory:");
  db.run("PRAGMA page_size=4096");
  db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO t (id, v) VALUES (?, ?)");
  db.transaction(() => { for (let id = 1; id <= 400; id++) insert.run(id, "a".repeat(60)); })();
  // Plain Uint8Array copies: Buffer#slice would alias the fixture.
  const v1 = new Uint8Array(db.serialize());
  // Same-sized values: the page count stays the same, only page contents and
  // the header's change counter move. A torn mix stays header-valid.
  db.run("UPDATE t SET v = ?", ["b".repeat(60)]);
  const v2 = new Uint8Array(db.serialize());
  db.close();
  return { v1, v2 };
}
const { v1, v2 } = makeImages();
// The previous leader wrote page 1 (new change counter) and the next pages of
// a transaction, and the reader observed the rest before they were rewritten.
const torn = (() => {
  const image = v1.slice();
  image.set(v2.subarray(0, PAGE * Math.floor(v1.byteLength / PAGE / 2)));
  return image;
})();
const rows = (image: Uint8Array) => {
  const db = Database.deserialize(image.slice());
  try { return db.query("SELECT v, count(*) AS n FROM t GROUP BY v ORDER BY v").all(); } finally { db.close(); }
};

describe("fast-path snapshot guard", () => {
  test("fixtures are real SQLite images and the torn mix passes header checks", () => {
    expect(v1.byteLength).toBe(v2.byteLength);
    expect(v1.byteLength / PAGE).toBeGreaterThan(4);
    expect([isCompleteSqliteImage(v1), isCompleteSqliteImage(v2), isCompleteSqliteImage(torn)]).toEqual([true, true, true]);
    // A torn image is not a state that ever existed: it mixes both versions.
    expect(rows(torn)).not.toEqual(rows(v1));
    expect(rows(torn)).not.toEqual(rows(v2));
  });

  test("pool headers decode exactly like LiveStore's decoder", async () => {
    for (const bytes of [dbFile(v1), journalFile(), unassociated()]) {
      const entry = decodePoolHeader(bytes.subarray(0, 524));
      expect("path" in entry ? entry.path : null).toBe(await decodeSAHPoolFilename(new Blob([bytes]) as File));
    }
    const corrupt = dbFile(v1);
    corrupt[3] ^= 1;
    expect(decodePoolHeader(corrupt.subarray(0, 524))).toEqual({ corrupt: true });
  });

  test("a committed, quiescent image takes the fast path", async () => {
    const result = await readGuardedSnapshot(stable([unassociated(), dbFile(v2), poolFile("/eventlog.db", SQLITE_OPEN_MAIN_DB, v1)]), DB);
    expect(result.path).toBe("fast");
    expect(result.snapshot).toEqual(v2);
    expect(rows(result.snapshot!)).toEqual([{ v: "b".repeat(60), n: 400 }]);
  });

  test("no local state uses the leader without counting as a fallback", async () => {
    expect(await readGuardedSnapshot(stable([unassociated()]), DB)).toEqual({ snapshot: undefined, path: "leader" });
    expect(await readGuardedSnapshot(stable([dbFile(new Uint8Array())]), DB)).toEqual({ snapshot: undefined, path: "leader" });
    expect(await readGuardedSnapshot(stable([dbFile(v1)]), "/state456.db")).toEqual({ snapshot: undefined, path: "leader" });
  });

  test("a hot journal left by a killed leader rejects its torn image", async () => {
    const result = await readGuardedSnapshot(stable([dbFile(torn), journalFile()]), DB);
    expect(result).toEqual({ snapshot: undefined, path: "fallback-journal" });
  });

  test("a whole transaction inside the first read is caught by the second read", async () => {
    // Directory scan sees v1 and no journal; the leader then journals, writes
    // and commits while the first image is read (torn); before the next scan
    // the journal is already gone, and the second read sees v2.
    // getFile order: scan0 (2 files), read A, scan1 (2), read B, scan2 (2).
    const { directory } = scriptedPool([
      [dbFile(v1), unassociated()], [dbFile(v1), unassociated()],
      [dbFile(torn), journalFile()],
      [dbFile(v2), unassociated()], [dbFile(v2), unassociated()],
      [dbFile(v2), unassociated()],
    ]);
    expect(await readGuardedSnapshot(directory, DB)).toEqual({ snapshot: undefined, path: "fallback-changed" });
  });

  test("a transaction still open between the reads is caught by the journal", async () => {
    const { directory } = scriptedPool([
      [dbFile(v1), unassociated()], [dbFile(v1), unassociated()],
      [dbFile(torn), journalFile()],
      [dbFile(torn), journalFile()], [dbFile(torn), journalFile()],
    ]);
    expect(await readGuardedSnapshot(directory, DB)).toEqual({ snapshot: undefined, path: "fallback-journal" });
  });

  test("a transaction starting during the second read is rejected too", async () => {
    const { directory } = scriptedPool([
      [dbFile(v1), unassociated()], [dbFile(v1), unassociated()], [dbFile(v1)],
      [dbFile(v1), unassociated()], [dbFile(v1), unassociated()], [dbFile(v1)],
      [dbFile(torn), journalFile()],
    ]);
    expect(await readGuardedSnapshot(directory, DB)).toEqual({ snapshot: undefined, path: "fallback-journal" });
  });

  test("a commit landing after the first read but before the second is rejected", async () => {
    const { directory } = scriptedPool([
      [dbFile(v1), unassociated()], [dbFile(v1), unassociated()], [dbFile(v1)],
      [dbFile(v2), unassociated()], [dbFile(v2), unassociated()], [dbFile(v2)],
    ]);
    expect(await readGuardedSnapshot(directory, DB)).toEqual({ snapshot: undefined, path: "fallback-changed" });
  });

  test("partial, non-SQLite and WAL images are rejected before use", async () => {
    const truncated = v1.subarray(0, v1.byteLength - PAGE);
    const garbage = new Uint8Array(PAGE * 2).fill(1);
    const wal = v1.slice(); wal[18] = 2; wal[19] = 2;
    const staleCount = v1.slice(); new DataView(staleCount.buffer).setUint32(92, 12345);
    for (const image of [truncated, garbage, wal, staleCount]) {
      expect(isCompleteSqliteImage(image)).toBe(false);
      expect((await readGuardedSnapshot(stable([dbFile(image)]), DB)).path).toBe("fallback-invalid");
    }
    expect((await readGuardedSnapshot(stable([dbFile(v1), poolFile(`${DB}-wal`, 0x80000, v1)]), DB)).path).toBe("fallback-journal");
  });

  test("a pool header caught mid-rewrite is treated as busy", async () => {
    const corrupt = journalFile();
    corrupt[520] ^= 0xff;
    expect((await readGuardedSnapshot(stable([dbFile(v1), corrupt]), DB)).path).toBe("fallback-journal");
  });

  test("storage errors are classified and never thrown", async () => {
    const failing = (error: unknown): PoolDirectory => ({
      async *values() { yield { kind: "file", getFile: async () => { throw error; } }; },
    });
    expect((await readGuardedSnapshot(failing(new DOMException("changed", "NotReadableError")), DB)).path).toBe("fallback-changed");
    expect((await readGuardedSnapshot(failing(new DOMException("gone", "NotFoundError")), DB)).path).toBe("fallback-changed");
    expect((await readGuardedSnapshot(failing(new Error("disk")), DB)).path).toBe("fallback-error");
  });

  test("the adapter hook resolves the directory and reports the path", async () => {
    const reports: string[] = [];
    const pool = stable([dbFile(v1)]);
    const root = { getDirectoryHandle: async (name: string) => {
      if (name !== "livestore-store@4") throw new DOMException("missing", "NotFoundError");
      return pool;
    } } as unknown as FileSystemDirectoryHandle;
    const read = makeFastPathSnapshotReader(Promise.resolve(root), path => reports.push(path));
    expect(await read({ directory: "livestore-store@4", fileName: DB })).toEqual(v1);
    expect(await read({ directory: "livestore-other@4", fileName: DB })).toBeUndefined();
    const denied = makeFastPathSnapshotReader(Promise.reject(new Error("no OPFS")), path => reports.push(path));
    expect(await denied({ directory: "livestore-store@4", fileName: DB })).toBeUndefined();
    expect(reports).toEqual(["fast", "leader", "leader"]);
  });
});
