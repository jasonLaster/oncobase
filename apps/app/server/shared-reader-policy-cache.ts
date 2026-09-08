import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getCache, waitUntil } from "@vercel/functions";
type Entry<T> = { started: number; value: T };
type SharedCache = { get(key: string): Promise<unknown>; set(key: string, value: unknown, options: { ttl: number }): Promise<unknown> };
/** Share the original read timestamp, never a fresh TTL for an already cached policy. */
export function createSharedReaderPolicyCache<T>({ read, now = Date.now, maxAgeMs = 5000, background = waitUntil,
  shared = getCache({ namespace: "wiki-reader-policy-v1", keyHashFunction: key => bytesToHex(sha256(new TextEncoder().encode(key))) }) }: {
  read: (key: string) => Promise<T>; now?: () => number; maxAgeMs?: number;
  background?: (task: Promise<unknown>) => void; shared?: SharedCache;
}) {
  const memory = new Map<string, Entry<T>>(), pending = new Map<string, Promise<Entry<T>>>();
  const fresh = (entry: Entry<T> | undefined): entry is Entry<T> => Boolean(entry && Number.isFinite(entry.started) && now() >= entry.started && now() - entry.started < maxAgeMs);
  const remember = (key: string, entry: Entry<T>) => {
    if (!fresh(entry) || (memory.get(key)?.started ?? -Infinity) > entry.started) return;
    memory.delete(key); memory.set(key, entry);
    while (memory.size > 256) memory.delete(memory.keys().next().value!);
  };
  const refresh = (key: string) => {
    if (pending.has(key)) return pending.get(key)!;
    const started = now();
    const promise = read(key).then(value => {
      const entry = { started, value };
      if (maxAgeMs > 0 && !fresh(entry)) throw new Error("Reader policy lookup exceeded its freshness window");
      remember(key, entry);
      if (maxAgeMs > 0) background(shared.set(key, entry, { ttl: Math.ceil(maxAgeMs / 1000) }).catch(() => {}));
      return entry;
    });
    pending.set(key, promise);
    void promise.finally(() => pending.delete(key)).catch(() => {});
    return promise;
  };
  return {
    async get(key: string, { backgroundRefresh = true }: { backgroundRefresh?: boolean } = {}): Promise<T> {
      if (maxAgeMs === 0) return (await refresh(key)).value;
      let entry = memory.get(key);
      if (!fresh(entry)) {
        try { entry = await shared.get(key) as Entry<T> | undefined; } catch { entry = undefined; }
        if (fresh(entry)) remember(key, entry);
      }
      if (fresh(entry)) {
        if (backgroundRefresh && now() - entry.started >= 1000) background(refresh(key).catch(() => {}));
        return entry.value;
      }
      return (await refresh(key)).value;
    },
  };
}
