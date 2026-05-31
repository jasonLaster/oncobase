/* eslint-disable no-restricted-syntax */
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";
import type { Doc, Id } from "./_generated/dataModel";

function pathAllowed(path: string, patterns: string[]) {
  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    const normalized = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
    return path.startsWith(normalized);
  });
}

function cleanList(values: string[] | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function cleanTags(values: string[] | undefined) {
  return cleanList(values).map((tag) => tag.toLowerCase());
}

const LEGACY_SENSITIVE_INCLUDE_TAGS = new Map([
  ["echo-sensitive", "echo"],
  ["serova-sensitive", "serova"],
]);

function documentTagMatchesRuleTag(
  ruleTag: string,
  documentTags: Set<string>,
  sensitiveInclude: Set<string>,
) {
  const legacyAlias = LEGACY_SENSITIVE_INCLUDE_TAGS.get(ruleTag);
  if (legacyAlias) {
    return documentTags.has(ruleTag) || sensitiveInclude.has(legacyAlias);
  }

  if (documentTags.has(ruleTag) || sensitiveInclude.has(ruleTag)) {
    return true;
  }

  for (const [legacyTag, canonicalTag] of LEGACY_SENSITIVE_INCLUDE_TAGS) {
    if (canonicalTag === ruleTag && documentTags.has(legacyTag)) {
      return true;
    }
  }

  return false;
}

function cleanEmailPatterns(values: string[] | undefined) {
  return cleanList(values).map((pattern) => pattern.toLowerCase());
}

function emailMatchesPattern(email: string, pattern: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  const emailDomain = normalizedEmail.split("@")[1] ?? "";

  if (!normalizedEmail || !normalizedPattern || !emailDomain) return false;

  if (normalizedPattern.startsWith("*@")) {
    return emailDomain === normalizedPattern.slice(2);
  }

  if (normalizedPattern.startsWith("@")) {
    return emailDomain === normalizedPattern.slice(1);
  }

  if (!normalizedPattern.includes("@")) {
    return emailDomain === normalizedPattern;
  }

  return normalizedEmail === normalizedPattern;
}

function roleMatchesEmail(role: Doc<"roles">, email: string) {
  return cleanEmailPatterns(role.emailPatterns).some((pattern) =>
    emailMatchesPattern(email, pattern),
  );
}

type PermissionRule = Pick<
  Doc<"rolePermissions">,
  | "pathPattern"
  | "includePathPatterns"
  | "excludePathPatterns"
  | "includeTags"
  | "excludeTags"
>;

function ruleMatchesSlug(
  rule: PermissionRule,
  slug: string,
  documentTags: string[],
  documentSensitiveInclude: string[] = [],
) {
  const includePathPatterns = cleanList([
    ...(rule.pathPattern ? [rule.pathPattern] : []),
    ...(rule.includePathPatterns ?? []),
  ]);
  const excludePathPatterns = cleanList(rule.excludePathPatterns);
  const includeTags = cleanTags(rule.includeTags);
  const excludeTags = cleanTags(rule.excludeTags);
  const tagSet = new Set(
    documentTags.map((tag) => tag.trim().toLowerCase()),
  );
  const sensitiveIncludeSet = new Set(
    documentSensitiveInclude.map((tag) => tag.trim().toLowerCase()),
  );
  const pathMatches =
    includePathPatterns.length === 0 || pathAllowed(slug, includePathPatterns);
  const pathExcluded =
    excludePathPatterns.length > 0 && pathAllowed(slug, excludePathPatterns);
  const includeMatches =
    includeTags.length === 0 ||
    includeTags.some((tag) =>
      documentTagMatchesRuleTag(tag, tagSet, sensitiveIncludeSet),
    );
  const excludeMatches = excludeTags.some((tag) =>
    documentTagMatchesRuleTag(tag, tagSet, sensitiveIncludeSet),
  );

  return pathMatches && includeMatches && !pathExcluded && !excludeMatches;
}

async function findDocumentBySlug(ctx: QueryCtx, site: SiteCtx, slug: string) {
  if (site.siteId) {
    const scoped = await ctx.db
      .query("documents")
      .withIndex("by_site_slug", (q) =>
        q.eq("siteId", site.siteId!).eq("slug", slug),
      )
      .first();
    if (scoped) return scoped;
  }

  const legacy = await ctx.db
    .query("documents")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  if (legacy && rowBelongsToSite(legacy, site)) return legacy;
  return null;
}

function summarizePermissions(permissions: Doc<"rolePermissions">[]) {
  const includePathPatterns = cleanList(
    permissions.flatMap((permission) => [
      ...(permission.pathPattern ? [permission.pathPattern] : []),
      ...(permission.includePathPatterns ?? []),
    ]),
  );
  const excludePathPatterns = cleanList(
    permissions.flatMap((permission) => permission.excludePathPatterns ?? []),
  );
  return {
    rules: permissions.map((permission) => ({
      pathPattern: permission.pathPattern ?? "",
      includePathPatterns: cleanList([
        ...(permission.pathPattern ? [permission.pathPattern] : []),
        ...(permission.includePathPatterns ?? []),
      ]),
      excludePathPatterns: cleanList(permission.excludePathPatterns),
      includeTags: cleanTags(permission.includeTags),
      excludeTags: cleanTags(permission.excludeTags),
    })),
    permissions: includePathPatterns,
    pathPatterns: includePathPatterns,
    includePathPatterns,
    excludePathPatterns,
    includeTags: cleanTags(permissions.flatMap((permission) => permission.includeTags ?? [])),
    excludeTags: cleanTags(permissions.flatMap((permission) => permission.excludeTags ?? [])),
  };
}

async function replaceRolePermissions(
  ctx: MutationCtx,
  site: SiteCtx,
  roleId: Id<"roles">,
  {
    pathPatterns,
    includePathPatterns,
    excludePathPatterns,
    includeTags,
    excludeTags,
  }: {
    pathPatterns?: string[];
    includePathPatterns?: string[];
    excludePathPatterns?: string[];
    includeTags?: string[];
    excludeTags?: string[];
  },
) {
  const existing = site.siteId
    ? await ctx.db
        .query("rolePermissions")
        .withIndex("by_site_role", (q) =>
          q.eq("siteId", site.siteId!).eq("roleId", roleId),
        )
        .collect()
    : await ctx.db
        .query("rolePermissions")
        .withIndex("by_role", (q) => q.eq("roleId", roleId))
        .collect();

  for (const permission of existing) {
    if (rowBelongsToSite(permission, site)) {
      await ctx.db.delete(permission._id);
    }
  }

  const cleanedIncludePaths = cleanList([
    ...(pathPatterns ?? []),
    ...(includePathPatterns ?? []),
  ]);
  const cleanedExcludePaths = cleanList(excludePathPatterns);
  const cleanedIncludeTags = cleanTags(includeTags);
  const cleanedExcludeTags = cleanTags(excludeTags);
  const now = Date.now();

  if (
    cleanedIncludePaths.length === 0 &&
    cleanedIncludeTags.length === 0
  ) {
    return;
  }

  await ctx.db.insert("rolePermissions", {
    ...(site.siteId ? { siteId: site.siteId } : {}),
    roleId,
    ...(cleanedIncludePaths.length
      ? { includePathPatterns: cleanedIncludePaths }
      : {}),
    ...(cleanedExcludePaths.length
      ? { excludePathPatterns: cleanedExcludePaths }
      : {}),
    ...(cleanedIncludeTags.length ? { includeTags: cleanedIncludeTags } : {}),
    ...(cleanedExcludeTags.length ? { excludeTags: cleanedExcludeTags } : {}),
    createdAt: now,
  });
}

async function clearRoleAssignmentsForUser(
  ctx: MutationCtx,
  site: SiteCtx,
  userId: Id<"users">,
) {
  const assignments = site.siteId
    ? await ctx.db
        .query("userRoles")
        .withIndex("by_site_user", (q) =>
          q.eq("siteId", site.siteId!).eq("userId", userId),
        )
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
}

async function setRoleForSiteUser(
  ctx: MutationCtx,
  site: SiteCtx,
  userId: Id<"users">,
  roleId?: Id<"roles">,
) {
  const user = await ctx.db.get(userId);
  if (!user || !rowBelongsToSite(user, site)) {
    throw new Error("user does not belong to this site");
  }

  await clearRoleAssignmentsForUser(ctx, site, userId);

  if (!roleId) return null;

  return await ctx.db.insert("userRoles", {
    ...(site.siteId ? { siteId: site.siteId } : {}),
    userId,
    roleId,
    createdAt: Date.now(),
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
      .map((user) => {
        const roleNames = new Set(rolesByUser.get(user._id) ?? []);
        const roleIds = new Set(roleIdsByUser.get(user._id) ?? []);

        for (const role of rolesById.values()) {
          if (!roleMatchesEmail(role, user.email)) continue;
          roleNames.add(role.name);
          roleIds.add(String(role._id));
        }

        return {
          _id: user._id,
          email: user.email,
          name: user.name ?? null,
          roles: Array.from(roleNames),
          roleIds: Array.from(roleIds),
        };
      });
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
      .map((role) => {
        const rolePermissions = permissions.filter(
          (p) => p.roleId === role._id && rowBelongsToSite(p, site),
        );
        return {
          ...role,
          ...summarizePermissions(rolePermissions),
          emailPatterns: cleanEmailPatterns(role.emailPatterns),
        };
      });
  },
});

export const createRole = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    pathPatterns: v.optional(v.array(v.string())),
    includePathPatterns: v.optional(v.array(v.string())),
    excludePathPatterns: v.optional(v.array(v.string())),
    includeTags: v.optional(v.array(v.string())),
    excludeTags: v.optional(v.array(v.string())),
    emailPatterns: v.optional(v.array(v.string())),
    siteSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      name,
      description,
      pathPatterns,
      includePathPatterns,
      excludePathPatterns,
      includeTags,
      excludeTags,
      emailPatterns,
      siteSlug,
    },
  ) => {
    const site = await requireSite(ctx, siteSlug);
    const roleId = await ctx.db.insert("roles", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      name,
      description,
      emailPatterns: cleanEmailPatterns(emailPatterns),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await replaceRolePermissions(ctx, site, roleId, {
      pathPatterns,
      includePathPatterns,
      excludePathPatterns,
      includeTags,
      excludeTags,
    });
    return roleId;
  },
});

export const updateRole = mutation({
  args: {
    roleId: v.id("roles"),
    name: v.string(),
    description: v.optional(v.string()),
    pathPatterns: v.optional(v.array(v.string())),
    includePathPatterns: v.optional(v.array(v.string())),
    excludePathPatterns: v.optional(v.array(v.string())),
    includeTags: v.optional(v.array(v.string())),
    excludeTags: v.optional(v.array(v.string())),
    emailPatterns: v.optional(v.array(v.string())),
    siteSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      roleId,
      name,
      description,
      pathPatterns,
      includePathPatterns,
      excludePathPatterns,
      includeTags,
      excludeTags,
      emailPatterns,
      siteSlug,
    },
  ) => {
    const site = await requireSite(ctx, siteSlug);
    const role = await ctx.db.get(roleId);
    if (!role || !rowBelongsToSite(role, site)) {
      throw new Error("role does not belong to this site");
    }

    await ctx.db.patch(roleId, {
      name: name.trim(),
      description: description?.trim() || undefined,
      emailPatterns: cleanEmailPatterns(emailPatterns),
      updatedAt: Date.now(),
    });
    await replaceRolePermissions(ctx, site, roleId, {
      pathPatterns,
      includePathPatterns,
      excludePathPatterns,
      includeTags,
      excludeTags,
    });
    return roleId;
  },
});

export const deleteRole = mutation({
  args: { roleId: v.id("roles"), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { roleId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const role = await ctx.db.get(roleId);
    if (!role || !rowBelongsToSite(role, site)) {
      throw new Error("role does not belong to this site");
    }

    const permissions = site.siteId
      ? await ctx.db
          .query("rolePermissions")
          .withIndex("by_site_role", (q) =>
            q.eq("siteId", site.siteId!).eq("roleId", roleId),
          )
          .collect()
      : await ctx.db
          .query("rolePermissions")
          .withIndex("by_role", (q) => q.eq("roleId", roleId))
          .collect();
    for (const permission of permissions) {
      if (rowBelongsToSite(permission, site)) await ctx.db.delete(permission._id);
    }

    const assignments = await ctx.db.query("userRoles").collect();
    for (const assignment of assignments) {
      if (assignment.roleId === roleId && rowBelongsToSite(assignment, site)) {
        await ctx.db.delete(assignment._id);
      }
    }

    await ctx.db.delete(roleId);
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
    if (roleId) {
      const role = await ctx.db.get(roleId);
      if (!role || !rowBelongsToSite(role, site)) {
        throw new Error("role does not belong to this site");
      }
    }

    return await setRoleForSiteUser(ctx, site, userId, roleId);
  },
});

export const setRoleForUsers = mutation({
  args: {
    userIds: v.array(v.id("users")),
    roleId: v.optional(v.id("roles")),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { userIds, roleId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (roleId) {
      const role = await ctx.db.get(roleId);
      if (!role || !rowBelongsToSite(role, site)) {
        throw new Error("role does not belong to this site");
      }
    }

    let updated = 0;
    for (const userId of Array.from(new Set(userIds))) {
      await setRoleForSiteUser(ctx, site, userId, roleId);
      updated += 1;
    }
    return { updated };
  },
});

export const deleteUsers = mutation({
  args: {
    userIds: v.array(v.id("users")),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { userIds, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    let deleted = 0;
    let revokedSessions = 0;

    for (const userId of Array.from(new Set(userIds))) {
      const user = await ctx.db.get(userId);
      if (!user || !rowBelongsToSite(user, site)) {
        throw new Error("user does not belong to this site");
      }

      await clearRoleAssignmentsForUser(ctx, site, userId);

      const sessions = await ctx.db.query("userSessions").collect();
      for (const session of sessions) {
        if (session.userId === userId && rowBelongsToSite(session, site)) {
          await ctx.db.delete(session._id);
          revokedSessions += 1;
        }
      }

      await ctx.db.delete(userId);
      deleted += 1;
    }

    return { deleted, revokedSessions };
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
      patterns.push(
        ...perms
          .map((p) => p.pathPattern)
          .filter((pattern): pattern is string => Boolean(pattern)),
      );
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
    const doc = await findDocumentBySlug(ctx, site, slug);
    const documentTags = doc?.tags ?? [];
    const documentSensitiveInclude = doc?.sensitiveInclude ?? [];
    const protectedRules = (await ctx.db.query("rolePermissions").collect()).filter(
      (permission) =>
        rowBelongsToSite(permission, site) && rolesById.has(permission.roleId),
    );
    if (
      !protectedRules.some((rule) =>
        ruleMatchesSlug(rule, slug, documentTags, documentSensitiveInclude),
      )
    ) {
      return true;
    }

    const assignments = site.siteId
      ? await ctx.db
          .query("userRoles")
          .withIndex("by_site_user", (q) =>
            q.eq("siteId", site.siteId!).eq("userId", userId),
          )
          .collect()
      : await ctx.db
          .query("userRoles")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
    const user = await ctx.db.get(userId);
    const allowedRoleIds = new Set<string>();
    for (const assignment of assignments) {
      if (
        rowBelongsToSite(assignment, site) &&
        rolesById.has(assignment.roleId)
      ) {
        allowedRoleIds.add(String(assignment.roleId));
      }
    }
    if (user && rowBelongsToSite(user, site)) {
      for (const role of rolesById.values()) {
        if (roleMatchesEmail(role, user.email)) {
          allowedRoleIds.add(String(role._id));
        }
      }
    }
    const rules: PermissionRule[] = [];
    for (const roleId of allowedRoleIds) {
      const typedRoleId = roleId as Id<"roles">;
      const perms = site.siteId
        ? await ctx.db
            .query("rolePermissions")
            .withIndex("by_site_role", (q) =>
              q.eq("siteId", site.siteId!).eq("roleId", typedRoleId),
            )
            .collect()
        : await ctx.db
            .query("rolePermissions")
            .withIndex("by_role", (q) => q.eq("roleId", typedRoleId))
            .collect();
      for (const p of perms) if (rowBelongsToSite(p, site)) rules.push(p);
    }
    return rules.some((rule) =>
      ruleMatchesSlug(rule, slug, documentTags, documentSensitiveInclude),
    );
  },
});
