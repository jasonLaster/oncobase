// Per-instance memo of work derived from content-addressed manifest snapshots.
// A snapshot hash names immutable bytes, so anything computed only from those
// bytes (the encoded public response, the validated public base used by session
// overlays) can be reused until the hash changes. Never store per-user data here.

export type ManifestSnapshotCacheKind = "response" | "base" | "derived";

export type ManifestSnapshotCacheOptions = {
  /** Most recent entries kept; older ones are evicted first. */
  maxEntries?: number;
  /** Approximate cap on retained bytes across entries. */
  maxBytes?: number;
  /** Called once per lookup. Joining an in-flight load counts as a hit. */
  onLookup?: (hit: boolean, kind: ManifestSnapshotCacheKind) => void;
};

export type ManifestSnapshotCache = {
  /**
   * Returns the cached value for `key`, or runs `load` once and shares its
   * promise with concurrent callers. A rejected load is never retained.
   */
  get<T>(kind: ManifestSnapshotCacheKind, key: string, load: () => Promise<T>, sizeOf: (value: T) => number): Promise<T>;
  readonly size: number;
  clear(): void;
};

type Entry = { promise: Promise<unknown>; bytes: number };

export function createManifestSnapshotCache({
  maxEntries = 16,
  maxBytes = 32 * 1024 * 1024,
  onLookup,
}: ManifestSnapshotCacheOptions = {}): ManifestSnapshotCache {
  const entries = new Map<string, Entry>();
  const lookup = (hit: boolean, kind: ManifestSnapshotCacheKind) => {
    try { onLookup?.(hit, kind); } catch { /* Telemetry cannot fail readers. */ }
  };
  const evict = () => {
    let total = 0;
    for (const entry of entries.values()) total += entry.bytes;
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries && total <= maxBytes) break;
      entries.delete(key);
      total -= entry.bytes;
    }
  };
  return {
    get<T>(kind: ManifestSnapshotCacheKind, key: string, load: () => Promise<T>, sizeOf: (value: T) => number) {
      const id = `${kind}:${key}`;
      const existing = entries.get(id);
      if (existing) {
        // Map order is insertion order; re-inserting marks it most recent.
        entries.delete(id);
        entries.set(id, existing);
        lookup(true, kind);
        return existing.promise as Promise<T>;
      }
      lookup(false, kind);
      const entry: Entry = { promise: Promise.resolve(), bytes: 0 };
      const promise = (async () => load())().then(
        (value) => {
          entry.bytes = sizeOf(value);
          evict();
          return value;
        },
        (error: unknown) => {
          if (entries.get(id) === entry) entries.delete(id);
          throw error;
        },
      );
      entry.promise = promise;
      entries.set(id, entry);
      evict();
      return promise;
    },
    get size() { return entries.size; },
    clear() { entries.clear(); },
  };
}
