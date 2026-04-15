import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Return all room IDs that have at least one thread. */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("commentRooms").collect();
    return rows
      .filter((r) => r.threadCount > 0)
      .map((r) => r.roomId);
  },
});

/** Increment thread count for a room (called on threadCreated). */
export const incrementRoom = mutation({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const existing = await ctx.db
      .query("commentRooms")
      .withIndex("by_room_id", (q) => q.eq("roomId", roomId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        threadCount: existing.threadCount + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("commentRooms", {
        roomId,
        threadCount: 1,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Decrement thread count for a room (called on threadDeleted). */
export const decrementRoom = mutation({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const existing = await ctx.db
      .query("commentRooms")
      .withIndex("by_room_id", (q) => q.eq("roomId", roomId))
      .first();

    if (existing) {
      const newCount = Math.max(0, existing.threadCount - 1);
      await ctx.db.patch(existing._id, {
        threadCount: newCount,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Bulk-sync room data (used for initial seed / periodic reconciliation). */
export const syncRooms = mutation({
  args: {
    rooms: v.array(
      v.object({ roomId: v.string(), threadCount: v.number() })
    ),
  },
  handler: async (ctx, { rooms }) => {
    const now = Date.now();
    for (const { roomId, threadCount } of rooms) {
      const existing = await ctx.db
        .query("commentRooms")
        .withIndex("by_room_id", (q) => q.eq("roomId", roomId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, { threadCount, updatedAt: now });
      } else {
        await ctx.db.insert("commentRooms", { roomId, threadCount, updatedAt: now });
      }
    }
  },
});
