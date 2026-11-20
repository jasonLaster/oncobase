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
