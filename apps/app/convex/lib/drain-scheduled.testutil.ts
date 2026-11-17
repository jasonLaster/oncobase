// Test-only (Convex skips files with more than one "." in the name).
import type { GenericDatabaseWriter, GenericMutationCtx } from "convex/server";

type Runner = {
  run: <Output>(fn: (ctx: GenericMutationCtx<any> & { db: GenericDatabaseWriter<any> }) => Promise<Output>) => Promise<Output>;
  finishInProgressScheduledFunctions: () => Promise<void>;
};

/**
 * Leave no scheduled job behind a convex-test instance. Cancelling stops only
 * pending jobs: a 0 ms job (publish-change cleanup) or a build whose timer has
 * fired is already running, and if it finishes after the test it writes into
 * a finished instance. That surfaces as "Write outside of transaction
 * …_scheduled_functions" in whichever test file runs next.
 */
export async function drainScheduled(t: Runner) {
  await t.run(async ctx => {
    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    }
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  await t.finishInProgressScheduledFunctions();
}
