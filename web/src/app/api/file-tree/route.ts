import { getCompactFileTreeForSite, getFileTreeForSite } from "@/lib/markdown";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteSlugFromRequest } from "@/lib/site";

// Resolve the site outside the cached helper and pass it explicitly.
// That keeps `getFileTreeForSite(siteSlug)` site-scoped and guarantees this
// endpoint returns the full cached tree, not the PPR shell tree.
export async function GET(request: Request) {
  const siteSlug = siteSlugFromRequest(request);
  const url = new URL(request.url);
  const includeSensitive = Boolean(await getSessionUserFromRequest(request));

  if (url.searchParams.get("format") === "compact") {
    const tree = await getCompactFileTreeForSite(siteSlug, { includeSensitive });
    return Response.json(tree);
  }

  const tree = await getFileTreeForSite(siteSlug, { includeSensitive });
  return Response.json(tree);
}
