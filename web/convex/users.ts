import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getByEmailForAuth = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
  },
});

export const create = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    passwordSalt: v.string(),
  },
  handler: async (ctx, { email, name, passwordHash, passwordSalt }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existing) {
      throw new Error("An account with that email already exists");
    }

    const now = Date.now();
    return await ctx.db.insert("users", {
      email,
      name,
      passwordHash,
      passwordSalt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createSession = mutation({
  args: {
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { userId, tokenHash, expiresAt }) => {
    const now = Date.now();
    return await ctx.db.insert("userSessions", {
      userId,
      tokenHash,
      createdAt: now,
      expiresAt,
    });
  },
});

export const getSessionUser = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db
      .query("userSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!session || session.expiresAt <= Date.now()) {
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user) return null;

    return {
      _id: user._id,
      email: user.email,
      name: user.name ?? null,
      createdAt: user.createdAt,
    };
  },
});

export const getUsersByIds = query({
  args: { ids: v.array(v.id("users")) },
  handler: async (ctx, { ids }) => {
    const results: Array<{ id: string; name: string | null; email: string }> = [];
    for (const id of ids) {
      try {
        const user = await ctx.db.get(id);
        if (user) {
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
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db
      .query("userSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!session) return { deleted: false };

    await ctx.db.delete(session._id);
    return { deleted: true };
  },
});
