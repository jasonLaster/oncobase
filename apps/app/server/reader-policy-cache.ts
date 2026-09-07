/** Bounded freshness, never stale-on-error. The clock starts before the read. */
export function createReaderPolicyCache<T>(options: {
  read: (key: string) => Promise<T>; now?: () => number;
  background?: (promise: Promise<unknown>) => void; maxAgeMs?: number;
}) {
  const now = options.now ?? Date.now;
  const maxAge = options.maxAgeMs ?? 5000;
  const entries = new Map<string, { value: T; started: number; sequence: number }>();
  const pending = new Map<string, Promise<T>>();
  let sequence = 0;
  const begin = () => ({ started: now(), sequence: ++sequence });
  const put = (key: string, value: T, ticket: ReturnType<typeof begin>) => {
    if (now() - ticket.started >= maxAge || (entries.get(key)?.sequence ?? -1) > ticket.sequence) return;
    entries.delete(key); entries.set(key, { value, ...ticket });
    while (entries.size > 16) entries.delete(entries.keys().next().value!);
  };
  const refresh = (key: string) => {
    const inflight = pending.get(key);
    if (inflight) return inflight;
    const ticket = begin();
    const promise = options.read(key).then(value => {
      if (maxAge > 0 && now() - ticket.started >= maxAge) throw new Error("Reader policy lookup exceeded its freshness window");
      put(key, value, ticket);
      const current = entries.get(key);
      return current && current.sequence > ticket.sequence && now() - current.started < maxAge ? current.value : value;
    });
    pending.set(key, promise);
    void promise.finally(() => { if (pending.get(key) === promise) pending.delete(key); }).catch(() => {});
    return promise;
  };
  return {
    begin, put,
    async get(key: string): Promise<T> {
      const cached = entries.get(key);
      if (cached && now() >= cached.started && now() - cached.started < maxAge) {
        // Refresh during ordinary traffic so a later navigation usually needs
        // neither a policy lookup nor a page lookup. No timers or keepalive job.
        if (now() - cached.started >= 1000 && options.background) options.background(refresh(key).catch(() => {}));
        return cached.value;
      }
      return refresh(key);
    },
  };
}
