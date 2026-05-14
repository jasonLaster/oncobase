import { cacheTag } from "next/cache";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { shouldSkipConvexReads } from "@/lib/convex-url";
import { siteCacheTag } from "@/lib/wiki-cache-tags";

export async function getSitePublishVersion(siteSlug: string): Promise<string> {
  "use cache";
  cacheTag(siteCacheTag(siteSlug));

  if (shouldSkipConvexReads()) return "preview";

  const site = await getConvexServerClient().query(api.sites.getBySlug, {
    slug: siteSlug,
  });
  const version = site?.lastPublishedAt ?? site?.updatedAt ?? 0;
  return String(version);
}
