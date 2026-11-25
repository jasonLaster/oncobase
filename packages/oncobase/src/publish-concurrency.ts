export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  let failed = false;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (true) {
        if (failed) return;
        const i = next++;
        if (i >= items.length) return;
        try { await worker(items[i], i); }
        catch (error) { failed = true; throw error; }
      }
    })(),
  );
  const results = await Promise.allSettled(runners);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}
