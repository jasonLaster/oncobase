/**
 * A bounded worker pool over items that arrive over time, so a consumer
 * phase (document upload) can start on each item as soon as a producer phase
 * (embedding) finishes it. Workers run in the async context of `drain`'s
 * caller, which keeps their profile spans under that phase.
 *
 * The first failure, from a worker or reported by the producer through
 * `fail`, stops intake and is what `drain` rejects with.
 */
export class WorkQueue<T> {
  private items: T[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;
  private failure: { error: unknown } | undefined;

  push(item: T) {
    if (this.failure) return;
    if (this.closed) throw new Error("WorkQueue is closed");
    this.items.push(item);
    this.wake();
  }

  /** No more items will arrive; workers exit once the queue is empty. */
  close() {
    this.closed = true;
    this.wake();
  }

  fail(error: unknown) {
    this.failure ??= { error };
    this.closed = true;
    this.items.length = 0;
    this.wake();
  }

  get failed() {
    return this.failure !== undefined;
  }

  async drain(limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    const runners = Array.from({ length: Math.max(1, limit) }, async () => {
      for (let next = await this.take(); next; next = await this.take()) {
        try { await worker(next.item); }
        catch (error) { this.fail(error); return; }
      }
    });
    await Promise.all(runners);
    if (this.failure) throw this.failure.error;
  }

  private wake() {
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  private async take(): Promise<{ item: T } | undefined> {
    for (;;) {
      if (this.failure) return undefined;
      if (this.items.length) return { item: this.items.shift()! };
      if (this.closed) return undefined;
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
  }
}
