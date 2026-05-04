import { getFileTreeForSite } from "@/lib/markdown";
import { siteSlugFromRequest } from "@/lib/site";

// Resolve the site outside the cached helper and pass it explicitly.
// That keeps `getFileTreeForSite(siteSlug)` site-scoped and guarantees this
// endpoint returns the full cached tree, not the PPR shell tree.
export async function GET(request: Request) {
  const siteSlug = siteSlugFromRequest(request);
  const tree = await getFileTreeForSite(siteSlug);
  return Response.json(tree);
}
