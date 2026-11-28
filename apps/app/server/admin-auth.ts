import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

type SessionUser = {
  _id: Id<"users">;
  email: string;
  name?: string | null;
};

/** The site owner, or a user holding the site's admin role. */
export async function isAdminSessionUser(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
) {
  if (!user) return false;
  const site = await client.query(api.sites.getBySlug, { slug: siteSlug });
  if (site?.ownerEmail?.toLowerCase() === user.email.toLowerCase()) return true;
  const users = await client.query(api.access.listUsersWithRoles, { siteSlug }).catch(() => []);
  const userWithRoles = users.find((item: { _id: string }) => item._id === user._id);
  return Boolean(
    userWithRoles?.roles?.some(
      (role: string) => role.trim().toLowerCase() === "admin",
    ),
  );
}

/**
 * The user's role names on the site, lowercased: explicit assignments and
 * email-pattern grants (from access.listUsersWithRoles, the same source as
 * isAdminSessionUser), plus "admin" for the site owner. A lookup failure
 * yields no roles, so callers deny.
 */
export async function sessionUserRoleNames(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
): Promise<string[]> {
  if (!user) return [];
  const [site, users] = await Promise.all([
    client.query(api.sites.getBySlug, { slug: siteSlug }).catch(() => null),
    client.query(api.access.listUsersWithRoles, { siteSlug }).catch(() => []),
  ]);
  const roles = new Set<string>();
  const userWithRoles = users.find((item: { _id: string }) => item._id === user._id);
  for (const role of (userWithRoles?.roles ?? []) as string[]) {
    const name = role.trim().toLowerCase();
    if (name) roles.add(name);
  }
  if (site?.ownerEmail?.toLowerCase() === user.email.toLowerCase()) roles.add("admin");
  return [...roles];
}
