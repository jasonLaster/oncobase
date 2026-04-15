import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsert = mutation({
  args: { guestId: v.string(), name: v.string() },
  handler: async (ctx, { guestId, name }) => {
    const existing = await ctx.db
      .query("guestNames")
      .withIndex("by_guest_id", (q) => q.eq("guestId", guestId))
      .first();

    if (existing) {
      if (existing.name !== name) {
        await ctx.db.patch(existing._id, { name, updatedAt: Date.now() });
      }
      return existing._id;
    }

    return await ctx.db.insert("guestNames", {
      guestId,
      name,
      updatedAt: Date.now(),
    });
  },
});

export const getByIds = query({
  args: { guestIds: v.array(v.string()) },
  handler: async (ctx, { guestIds }) => {
    const results: Record<string, string> = {};
    for (const guestId of guestIds) {
      const row = await ctx.db
        .query("guestNames")
        .withIndex("by_guest_id", (q) => q.eq("guestId", guestId))
        .first();
      if (row) {
        results[guestId] = row.name;
      }
    }
    return results;
  },
});
