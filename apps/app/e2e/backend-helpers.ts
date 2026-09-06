import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

// Only isolated E2E sites may use site-wide user cleanup.
export async function cleanupSiteUsers(convex: ConvexHttpClient, siteSlug: string) {
  if (!/^vite-(rbac|tag-page)-[a-z0-9-]+$/.test(siteSlug)) throw new Error("User cleanup requires an isolated e2e site");
  const users = await convex.query(api.access.listUsersWithRoles, { siteSlug });
  const userIds = users.map(user => user._id);
  if (userIds.length) await convex.mutation(api.access.deleteUsers, { siteSlug, userIds });
}
