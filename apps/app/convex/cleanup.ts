import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// Expired rows are already rejected on read (getSessionUser, consumeOAuthState)
// but were never deleted. These purges run from crons.ts. Each call deletes a
// bounded batch through the expiry index and reschedules itself while a full
// batch was found, so one run never approaches a transaction's limits.
// Document/asset tombstones are deliberately not purged here: deletedAt rows
// are the documented 90-day undo window for publisher deletions.
export const PURGE_BATCH_SIZE = 200;
// Never chase an unbounded backlog in one cron tick; the next tick continues.
const MAX_CHAINED_BATCHES = 50;

const purgeArgs = { batches: v.optional(v.number()) };

export const purgeExpiredSessions = internalMutation({
  args: purgeArgs,
  handler: async (ctx, { batches = 0 }): Promise<{ deleted: number }> => {
    // eslint-disable-next-line no-restricted-syntax -- Cross-tenant maintenance by design: expiry, not tenant, selects rows.
    const expired = await ctx.db.query("userSessions").withIndex("by_expires", q => q.lt("expiresAt", Date.now())).take(PURGE_BATCH_SIZE);
    await Promise.all(expired.map(row => ctx.db.delete(row._id)));
    if (expired.length === PURGE_BATCH_SIZE && batches + 1 < MAX_CHAINED_BATCHES) {
      await ctx.scheduler.runAfter(0, internal.cleanup.purgeExpiredSessions, { batches: batches + 1 });
    }
    return { deleted: expired.length };
  },
});

export const purgeExpiredOAuthStates = internalMutation({
  args: purgeArgs,
  handler: async (ctx, { batches = 0 }): Promise<{ deleted: number }> => {
    // eslint-disable-next-line no-restricted-syntax -- Cross-tenant maintenance by design: expiry, not tenant, selects rows.
    const expired = await ctx.db.query("epicFhirOAuthStates").withIndex("by_expires", q => q.lt("expiresAt", Date.now())).take(PURGE_BATCH_SIZE);
    await Promise.all(expired.map(row => ctx.db.delete(row._id)));
    if (expired.length === PURGE_BATCH_SIZE && batches + 1 < MAX_CHAINED_BATCHES) {
      await ctx.scheduler.runAfter(0, internal.cleanup.purgeExpiredOAuthStates, { batches: batches + 1 });
    }
    return { deleted: expired.length };
  },
});
