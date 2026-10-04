import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

// ConvexHttpClient serializes every mutation through one per-client queue
// unless `skipQueue` is set. The server shares one client across concurrent
// requests, so that queue makes unrelated requests wait on each other.
// Writes that must stay ordered relative to each other (one chat run's
// streaming flushes) get their own chain here instead of the global queue.
export function orderedMutations(client: Pick<ConvexHttpClient, "mutation">) {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    mutation(ref: FunctionReference<"mutation">, args: Record<string, unknown>): Promise<unknown> {
      const run = tail.then(() => client.mutation(ref, args as never, { skipQueue: true }));
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
