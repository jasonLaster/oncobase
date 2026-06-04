import { getAllPageEntriesForSite } from "@/lib/markdown";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";
import { getSessionUserFromRequest } from "@/lib/session-user";

const PUBLIC_PAGES_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const PRIVATE_PAGES_CACHE_CONTROL =
  "private, max-age=60, stale-while-revalidate=3600";

function pageHeaders(cacheScope: "public" | "private") {
  return {
    "Cache-Control":
      cacheScope === "public"
        ? PUBLIC_PAGES_CACHE_CONTROL
        : PRIVATE_PAGES_CACHE_CONTROL,
    Vary:
      cacheScope === "public"
        ? "Accept, x-site-slug"
        : "Accept, Cookie, x-site-slug",
    "X-Pages-Cache": cacheScope,
  };
}

export async function GET(request: Request) {
  const siteSlug = toSiteSlug(
    request.headers.get("x-site-slug") ?? DEFAULT_SITE_SLUG,
  );
  const sessionUser = await getSessionUserFromRequest(request);
  const includeSensitive = Boolean(sessionUser);
  const pages = await getAllPageEntriesForSite(siteSlug, { includeSensitive });
  return Response.json(pages, {
    headers: pageHeaders(includeSensitive ? "private" : "public"),
  });
}
