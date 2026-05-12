/* eslint-disable no-restricted-syntax */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSite, rowBelongsToSite } from "./lib/site";

function pathAllowed(path: string, patterns: string[]) {
  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    const normalized = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
    return path.startsWith(normalized);
  });
}

export const listUsersWithRoles = query({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const users = site.siteId
      ? await ctx.db.query("users").withIndex("by_site_email", (q) => q.eq("siteId", site.siteId!)).collect()
      : await ctx.db.query("users").collect();

    const assignments = site.siteId
      ? await ctx.db.query("userRoles").withIndex("by_site_user", (q) => q.eq("siteId", site.siteId!)).collect()
      : await ctx.db.query("userRoles").collect();

    const rolesById = new Map();
    for (const role of await ctx.db.query("roles").collect()) {
      if (rowBelongsToSite(role, site)) rolesById.set(role._id, role);
    }

    const rolesByUser = new Map<string, string[]>();
    const roleIdsByUser = new Map<string, string[]>();
    for (const a of assignments) {
      if (!rowBelongsToSite(a, site)) continue;
      const role = rolesById.get(a.roleId);
      if (!role) continue;
      const list = rolesByUser.get(a.userId) ?? [];
      list.push(role.name);
      rolesByUser.set(a.userId, list);
      const idList = roleIdsByUser.get(a.userId) ?? [];
      idList.push(String(role._id));
      roleIdsByUser.set(a.userId, idList);
    }

    return users
      .filter((user) => rowBelongsToSite(user, site))
      .map((user) => ({
        _id: user._id,
        email: user.email,
        name: user.name ?? null,
        roles: rolesByUser.get(user._id) ?? [],
        roleIds: roleIdsByUser.get(user._id) ?? [],
      }));
  },
});

export const listRoles = query({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const roles = await ctx.db.query("roles").collect();
    const permissions = await ctx.db.query("rolePermissions").collect();
    return roles
      .filter((r) => rowBelongsToSite(r, site))
      .map((role) => ({
        ...role,
        permissions: permissions
          .filter((p) => p.roleId === role._id && rowBelongsToSite(p, site))
          .map((p) => p.pathPattern),
      }));
  },
});

export const createRole = mutation({
  args: { name: v.string(), description: v.optional(v.string()), pathPatterns: v.array(v.string()), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { name, description, pathPatterns, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const roleId = await ctx.db.insert("roles", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      name,
      description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const pathPattern of pathPatterns) {
      await ctx.db.insert("rolePermissions", {
        ...(site.siteId ? { siteId: site.siteId } : {}),
        roleId,
        pathPattern,
        createdAt: Date.now(),
      });
    }
    return roleId;
  },
});

export const assignRoleToUser = mutation({
  args: { userId: v.id("users"), roleId: v.id("roles"), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { userId, roleId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const existing = await ctx.db
      .query("userRoles")
      .withIndex("by_user_role", (q) => q.eq("userId", userId).eq("roleId", roleId))
      .first();
    if (existing && rowBelongsToSite(existing, site)) return existing._id;
    return await ctx.db.insert("userRoles", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      userId,
      roleId,
      createdAt: Date.now(),
    });
  },
});

export const setRoleForUser = mutation({
  args: { userId: v.id("users"), roleId: v.optional(v.id("roles")), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { userId, roleId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const user = await ctx.db.get(userId);
    if (!user || !rowBelongsToSite(user, site)) {
      throw new Error("user does not belong to this site");
    }

    if (roleId) {
      const role = await ctx.db.get(roleId);
      if (!role || !rowBelongsToSite(role, site)) {
        throw new Error("role does not belong to this site");
      }
    }

    const assignments = site.siteId
      ? await ctx.db
          .query("userRoles")
          .withIndex("by_site_user", (q) => q.eq("siteId", site.siteId!).eq("userId", userId))
          .collect()
      : await ctx.db
          .query("userRoles")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();

    for (const assignment of assignments) {
      if (rowBelongsToSite(assignment, site)) {
        await ctx.db.delete(assignment._id);
      }
    }

    if (!roleId) return null;

    return await ctx.db.insert("userRoles", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      userId,
      roleId,
      createdAt: Date.now(),
    });
  },
});

export const getUserAllowedPaths = query({
  args: { userId: v.id("users"), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { userId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const assignments = await ctx.db
      .query("userRoles")
      .withIndex("by_site_user", (q) => q.eq("siteId", site.siteId!).eq("userId", userId))
      .collect();
    const patterns: string[] = [];
    for (const a of assignments) {
      const perms = await ctx.db
        .query("rolePermissions")
        .withIndex("by_site_role", (q) => q.eq("siteId", site.siteId!).eq("roleId", a.roleId))
        .collect();
      patterns.push(...perms.map((p) => p.pathPattern));
    }
    return Array.from(new Set(patterns));
  },
});

export const canUserAccessSlug = query({
  args: { userId: v.id("users"), slug: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { userId, slug, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const roles = await ctx.db.query("roles").collect();
    const rolesById = new Map();
    for (const role of roles) {
      if (rowBelongsToSite(role, site)) rolesById.set(role._id, role);
    }
    const protectedPatterns: string[] = [];
    for (const permission of await ctx.db.query("rolePermissions").collect()) {
      if (!rowBelongsToSite(permission, site)) continue;
      if (!rolesById.has(permission.roleId)) continue;
      protectedPatterns.push(permission.pathPattern);
    }
    if (!pathAllowed(slug, protectedPatterns)) return true;

    const assignments = site.siteId
      ? await ctx.db.query("userRoles").withIndex("by_site_user", (q) => q.eq("siteId", site.siteId!).eq("userId", userId)).collect()
      : await ctx.db.query("userRoles").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const patterns: string[] = [];
    for (const a of assignments) {
      if (!rowBelongsToSite(a, site)) continue;
      if (!rolesById.has(a.roleId)) continue;
      const perms = site.siteId
        ? await ctx.db.query("rolePermissions").withIndex("by_site_role", (q) => q.eq("siteId", site.siteId!).eq("roleId", a.roleId)).collect()
        : await ctx.db.query("rolePermissions").withIndex("by_role", (q) => q.eq("roleId", a.roleId)).collect();
      for (const p of perms) if (rowBelongsToSite(p, site)) patterns.push(p.pathPattern);
    }
    return pathAllowed(slug, patterns);
  },
});
