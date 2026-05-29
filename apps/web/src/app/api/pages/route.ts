import { getAllPageEntriesForSite } from "@/lib/markdown";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";
import { getSessionUserFromRequest } from "@/lib/session-user";

export async function GET(request: Request) {
  const siteSlug = toSiteSlug(
    request.headers.get("x-site-slug") ?? DEFAULT_SITE_SLUG,
  );
  const includeSensitive = Boolean(await getSessionUserFromRequest(request));
  const pages = await getAllPageEntriesForSite(siteSlug, { includeSensitive });
  return Response.json(pages);
}
