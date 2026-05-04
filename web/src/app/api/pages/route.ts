import { getAllPageEntriesForSite } from "@/lib/markdown";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";

export async function GET(request: Request) {
  const siteSlug = toSiteSlug(
    request.headers.get("x-site-slug") ?? DEFAULT_SITE_SLUG,
  );
  const pages = await getAllPageEntriesForSite(siteSlug);
  return Response.json(pages);
}
