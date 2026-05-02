import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";

type AnyCtx = QueryCtx | MutationCtx;

async function findRoom(ctx: AnyCtx, site: SiteCtx, roomId: string) {
  const siteId = site.siteId;
  if (siteId) {
    const scoped = await ctx.db
      .query("commentRooms")
      .withIndex("by_site_room", (q) => q.eq("siteId", siteId).eq("roomId", roomId))
      .first();
    if (scoped) return scoped;
  }
  const legacy = await ctx.db
    .query("commentRooms")
    .withIndex("by_room_id", (q) => q.eq("roomId", roomId))
    .first();
  if (legacy && rowBelongsToSite(legacy, site)) return legacy;
  return null;
}

/** Return all room IDs that have at least one thread on the active site. */
export const listActive = query({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (site.siteId) {
      const scoped = await ctx.db
        .query("commentRooms")
        .withIndex("by_site_room", (q) => q.eq("siteId", site.siteId!))
        .collect();
      return scoped.filter((r) => r.threadCount > 0).map((r) => r.roomId);
    }
    const rows = await ctx.db.query("commentRooms").collect();
    return rows
      .filter((r) => rowBelongsToSite(r, site) && r.threadCount > 0)
      .map((r) => r.roomId);
  },
});

export const incrementRoom = mutation({
  args: { roomId: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { roomId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const existing = await findRoom(ctx, site, roomId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        threadCount: existing.threadCount + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("commentRooms", {
        ...(site.siteId ? { siteId: site.siteId } : {}),
        roomId,
        threadCount: 1,
        updatedAt: Date.now(),
      });
    }
  },
});

export const decrementRoom = mutation({
  args: { roomId: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { roomId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const existing = await findRoom(ctx, site, roomId);
    if (existing) {
      const newCount = Math.max(0, existing.threadCount - 1);
      await ctx.db.patch(existing._id, {
        threadCount: newCount,
        updatedAt: Date.now(),
      });
    }
  },
});

export const syncRooms = mutation({
  args: {
    rooms: v.array(v.object({ roomId: v.string(), threadCount: v.number() })),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { rooms, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const now = Date.now();
    for (const { roomId, threadCount } of rooms) {
      const existing = await findRoom(ctx, site, roomId);
      if (existing) {
        await ctx.db.patch(existing._id, { threadCount, updatedAt: now });
      } else {
        await ctx.db.insert("commentRooms", {
          ...(site.siteId ? { siteId: site.siteId } : {}),
          roomId,
          threadCount,
          updatedAt: now,
        });
      }
    }
  },
});
