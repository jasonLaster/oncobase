import fs from "node:fs";
import path from "node:path";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../apps/web/convex/_generated/api.js";
import type { Id } from "../../../apps/web/convex/_generated/dataModel.js";
import { isAdminSessionUser } from "./epic-fhir.js";
import { withSiteSlug } from "./wiki-api.js";

export type AdminSessionUser = {
  _id: Id<"users">;
  email: string;
  name?: string | null;
};

export type AccessRole = {
  _id: string;
  name: string;
  description?: string | null;
  permissions?: string[];
  pathPatterns?: string[];
  includePathPatterns?: string[];
  excludePathPatterns?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  emailPatterns?: string[];
};

export type AccessUser = {
  _id: string;
  email: string;
  name: string | null;
  roles: string[];
  roleIds: string[];
};

export type AccessPreviewPage = {
  slug: string;
  title: string;
  tags: string[];
  sensitiveInclude?: string[];
  sensitive?: boolean;
  sourceSensitive?: boolean;
};

const hiddenUserDomains = new Set(["example.test", "example.com"]);

export function normalizeRole(role: AccessRole) {
  return {
    ...role,
    includePathPatterns:
      role.includePathPatterns ?? role.pathPatterns ?? role.permissions ?? [],
    excludePathPatterns: role.excludePathPatterns ?? [],
    includeTags: role.includeTags ?? [],
    excludeTags: role.excludeTags ?? [],
    emailPatterns: role.emailPatterns ?? [],
  };
}

function isHiddenTestUser(user: AccessUser) {
  const domain = user.email.trim().toLowerCase().split("@")[1];
  return Boolean(domain && hiddenUserDomains.has(domain));
}

function visibleAdminUsers(users: AccessUser[]) {
  return users.filter((user) => !isHiddenTestUser(user));
}

export async function requireAdminUser({
  client,
  siteSlug,
  sessionUser,
}: {
  client: ConvexHttpClient;
  siteSlug: string;
  sessionUser: AdminSessionUser | null;
}) {
  if (!(await isAdminSessionUser(client, siteSlug, sessionUser))) {
    return null;
  }
  return sessionUser;
}

export async function getAccessUsersAndRoles(
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const [users, rawRoles] = (await Promise.all([
    client.query(api.access.listUsersWithRoles, withSiteSlug(siteSlug, {})),
    client.query(api.access.listRoles, withSiteSlug(siteSlug, {})),
  ])) as [AccessUser[], AccessRole[]];

  return {
    users: visibleAdminUsers(users),
    roles: rawRoles.map(normalizeRole),
  };
}

export async function getAccessPagesData(
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const [users, rawRoles, rawPreviewPages] = (await Promise.all([
    client.query(api.access.listUsersWithRoles, withSiteSlug(siteSlug, {})),
    client.query(api.access.listRoles, withSiteSlug(siteSlug, {})),
    client.action(
      api.documents.list,
      withSiteSlug(siteSlug, { includeSensitive: true }),
    ),
  ])) as [AccessUser[], AccessRole[], AccessPreviewPage[]];

  const sourceSensitiveSlugs = readSourceSensitiveSlugs();
  return {
    users: visibleAdminUsers(users),
    roles: rawRoles.map(normalizeRole),
    pages: rawPreviewPages
      .map((page) => ({
        slug: page.slug,
        title: page.title,
        tags: page.tags ?? [],
        sensitiveInclude: page.sensitiveInclude ?? [],
        sensitive: page.sensitive,
        sourceSensitive: sourceSensitiveSlugs?.has(page.slug),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

function candidateVaultPaths() {
  return [process.env.WIKI_VAULT_PATH, process.env.OBSIDIAN_VAULT_PATH].filter(
    (value): value is string => Boolean(value),
  );
}

function readSourceSensitiveSlugs() {
  if (process.env.VERCEL === "1") return null;
  const vaultPath = candidateVaultPaths().find((candidate) =>
    fs.existsSync(candidate),
  );
  if (!vaultPath) return null;
  try {
    return new Set(readSensitiveMarkdownSlugs(vaultPath));
  } catch {
    return null;
  }
}

function frontmatterIsSensitive(raw: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return false;
  return /^sensitive:\s*true\s*$/im.test(match[1] ?? "");
}

function readSensitiveMarkdownSlugs(dir: string, basePath = ""): string[] {
  const slugs: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      slugs.push(...readSensitiveMarkdownSlugs(fullPath, relativePath));
      continue;
    }
    if (!/\.(?:md|mdx)$/i.test(relativePath)) continue;
    if (frontmatterIsSensitive(fs.readFileSync(fullPath, "utf8"))) {
      slugs.push(relativePath.replace(/\.(?:md|mdx)$/i, ""));
    }
  }
  return slugs;
}

export async function createRole(
  client: ConvexHttpClient,
  siteSlug: string,
  values: Omit<AccessRole, "_id" | "permissions" | "pathPatterns">,
) {
  await client.mutation(api.access.createRole, withSiteSlug(siteSlug, values));
  return { ok: true };
}

export async function updateRole(
  client: ConvexHttpClient,
  siteSlug: string,
  roleId: string,
  values: Omit<AccessRole, "_id" | "permissions" | "pathPatterns">,
) {
  await client.mutation(
    api.access.updateRole,
    withSiteSlug(siteSlug, { roleId, ...values }),
  );
  return { ok: true };
}

export async function deleteRole(
  client: ConvexHttpClient,
  siteSlug: string,
  roleId: string,
) {
  await client.mutation(api.access.deleteRole, withSiteSlug(siteSlug, { roleId }));
  return { ok: true };
}

export async function setUserRole(
  client: ConvexHttpClient,
  siteSlug: string,
  userId: string,
  roleId?: string,
) {
  await client.mutation(
    api.access.setRoleForUser,
    withSiteSlug(siteSlug, { userId, roleId: roleId || undefined }),
  );
  return { ok: true };
}

export async function setUsersRole(
  client: ConvexHttpClient,
  siteSlug: string,
  userIds: string[],
  roleId?: string,
) {
  await client.mutation(
    api.access.setRoleForUsers,
    withSiteSlug(siteSlug, { userIds, roleId: roleId || undefined }),
  );
  return { ok: true };
}

export async function deleteUsers(
  client: ConvexHttpClient,
  siteSlug: string,
  userIds: string[],
) {
  await client.mutation(api.access.deleteUsers, withSiteSlug(siteSlug, { userIds }));
  return { ok: true };
}
