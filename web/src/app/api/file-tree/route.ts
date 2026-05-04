import { getFileTreeForSite } from "@/lib/markdown";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";

// Resolve from the proxy-set `x-site-slug` header and return the cached
// Convex-backed tree used by the PPR shell.
export async function GET(request: Request) {
  const siteSlug = toSiteSlug(
    request.headers.get("x-site-slug") ?? DEFAULT_SITE_SLUG,
  );
  const tree = await getFileTreeForSite(siteSlug);
  return Response.json(tree);
}
