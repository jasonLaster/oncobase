import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../web/convex/_generated/api";

export async function cleanupSiteUsers(
  convex: ConvexHttpClient,
  siteSlug: string,
) {
  const users = await convex.query(api.access.listUsersWithRoles, { siteSlug });
  const userIds = users.map((user) => user._id);
  if (userIds.length === 0) return;
  await convex.mutation(api.access.deleteUsers, { siteSlug, userIds });
}
