import { expect, test } from "bun:test";
import { makeFunctionReference } from "convex/server";
import { orderedMutations } from "./convex-mutations";

test("ordered mutations bypass the shared client queue but keep their own order", async () => {
  const events: string[] = [];
  const options: unknown[] = [];
  const client = {
    async mutation(_ref: unknown, args: { n: number }, opts?: unknown) {
      options.push(opts);
      events.push(`start ${args.n}`);
      await new Promise(resolve => setTimeout(resolve, args.n === 1 ? 10 : 1));
      if (args.n === 2) throw new Error("best effort");
      events.push(`end ${args.n}`);
      return args.n;
    },
  };
  const ordered = orderedMutations(client as never);
  const ref = makeFunctionReference<"mutation">("conversations:updateStreaming");
  const results = await Promise.allSettled([1, 2, 3].map(n => ordered.mutation(ref, { n })));
  expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  expect(events).toEqual(["start 1", "end 1", "start 2", "start 3", "end 3"]);
  expect(options).toEqual([{ skipQueue: true }, { skipQueue: true }, { skipQueue: true }]);
});
