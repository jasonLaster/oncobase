import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSite, rowBelongsToSite } from "./lib/site";

export const getByEmailForAuth = query({
  args: { email: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { email, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    if (siteId) {
      const scoped = await ctx.db
        .query("users")
        .withIndex("by_site_email", (q) => q.eq("siteId", siteId).eq("email", email))
        .first();
      if (scoped) return scoped;
    }
    const legacy = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (legacy && rowBelongsToSite(legacy, site)) return legacy;
    return null;
  },
});

export const create = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { email, name, passwordHash, passwordSalt, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    const existing = siteId
      ? await ctx.db
          .query("users")
          .withIndex("by_site_email", (q) => q.eq("siteId", siteId).eq("email", email))
          .first()
      : await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", email))
          .first();
    if (existing && rowBelongsToSite(existing, site)) {
      throw new Error("An account with that email already exists");
    }
    const now = Date.now();
    return await ctx.db.insert("users", {
      ...(siteId ? { siteId } : {}),
      email,
      name,
      passwordHash,
      passwordSalt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const resetPassword = mutation({
  args: {
    email: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    siteSlug: v.optional(v.string()),
    revokeSessions: v.optional(v.boolean()),
  },
  handler: async (ctx, { email, passwordHash, passwordSalt, siteSlug, revokeSessions }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    const user = siteId
      ? await ctx.db
          .query("users")
          .withIndex("by_site_email", (q) => q.eq("siteId", siteId).eq("email", normalizedEmail))
          .first()
      : await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
          .first();

    if (!user || !rowBelongsToSite(user, site)) {
      throw new Error(`No user found for ${normalizedEmail}`);
    }

    await ctx.db.patch(user._id, {
      passwordHash,
      passwordSalt,
      updatedAt: Date.now(),
    });

    let revokedSessions = 0;
    if (revokeSessions ?? true) {
      const sessions = await ctx.db.query("userSessions").collect();
      for (const session of sessions) {
        if (session.userId === user._id && rowBelongsToSite(session, site)) {
          await ctx.db.delete(session._id);
          revokedSessions += 1;
        }
      }
    }

    return {
      userId: user._id,
      email: normalizedEmail,
      revokedSessions,
    };
  },
});

export const createSession = mutation({
  args: {
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { userId, tokenHash, expiresAt, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    // Reject session creation for a user on a different site.
    const user = await ctx.db.get(userId);
    if (!user || !rowBelongsToSite(user, site)) {
      throw new Error("user does not belong to this site");
    }
    const now = Date.now();
    return await ctx.db.insert("userSessions", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      userId,
      tokenHash,
      createdAt: now,
      expiresAt,
    });
  },
});

export const getSessionUser = query({
  args: { tokenHash: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { tokenHash, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    const session = siteId
      ? await ctx.db
          .query("userSessions")
          .withIndex("by_site_token", (q) => q.eq("siteId", siteId).eq("tokenHash", tokenHash))
          .first()
      : await ctx.db
          .query("userSessions")
          .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
          .first();

    if (!session || !rowBelongsToSite(session, site)) return null;
    if (session.expiresAt <= Date.now()) return null;

    const user = await ctx.db.get(session.userId);
    if (!user || !rowBelongsToSite(user, site)) return null;

    return {
      _id: user._id,
      email: user.email,
      name: user.name ?? null,
      createdAt: user.createdAt,
    };
  },
});

export const getUsersByIds = query({
  args: { ids: v.array(v.id("users")), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { ids, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const results: Array<{ id: string; name: string | null; email: string }> = [];
    for (const id of ids) {
      try {
        const user = await ctx.db.get(id);
        if (user && rowBelongsToSite(user, site)) {
          results.push({ id, name: user.name ?? null, email: user.email });
        }
      } catch {
        // Skip invalid IDs
      }
    }
    return results;
  },
});

export const deleteSession = mutation({
  args: { tokenHash: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { tokenHash, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    const session = siteId
      ? await ctx.db
          .query("userSessions")
          .withIndex("by_site_token", (q) => q.eq("siteId", siteId).eq("tokenHash", tokenHash))
          .first()
      : await ctx.db
          .query("userSessions")
          .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
          .first();

    if (!session || !rowBelongsToSite(session, site)) return { deleted: false };

    await ctx.db.delete(session._id);
    return { deleted: true };
  },
});
