import { getCompactFileTreeForSite, getFileTreeForSite } from "@/lib/markdown";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteSlugFromRequest } from "@/lib/site";

const PUBLIC_TREE_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const PRIVATE_TREE_CACHE_CONTROL =
  "private, max-age=60, stale-while-revalidate=3600";

function fileTreeHeaders(cacheScope: "public" | "private", cacheKey: string) {
  return {
    "Cache-Control":
      cacheScope === "public"
        ? PUBLIC_TREE_CACHE_CONTROL
        : PRIVATE_TREE_CACHE_CONTROL,
    Vary:
      cacheScope === "public"
        ? "Accept, x-site-slug"
        : "Accept, Cookie, x-site-slug",
    "X-File-Tree-Cache": cacheScope,
    "X-File-Tree-Cache-Key": cacheKey,
  };
}

function cacheKeyPart(value: string) {
  return value.replace(/[^A-Za-z0-9:._/-]/g, "_").slice(0, 512);
}

// Resolve the site outside the cached helper and pass it explicitly.
// That keeps `getFileTreeForSite(siteSlug)` site-scoped and guarantees this
// endpoint returns the full cached tree, not the PPR shell tree.
export async function GET(request: Request) {
  const siteSlug = siteSlugFromRequest(request);
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const sessionUser =
    scope === "public" ? null : await getSessionUserFromRequest(request);
  const includeSensitive = Boolean(sessionUser);
  const cacheScope = includeSensitive ? "private" : "public";
  const requestedCacheKey = cacheKeyPart(
    url.searchParams.get("cacheKey") ?? "default",
  );
  const cacheKey =
    scope === "session" || cacheScope === "private"
      ? `${siteSlug}:session:${sessionUser?._id ?? "anonymous"}:${requestedCacheKey}`
      : `${siteSlug}:public:${requestedCacheKey}`;

  if (scope === "session" && !sessionUser) {
    return new Response(null, {
      status: 204,
      headers: fileTreeHeaders("private", cacheKey),
    });
  }

  if (url.searchParams.get("format") === "compact") {
    const tree = await getCompactFileTreeForSite(siteSlug, { includeSensitive });
    return Response.json(tree, { headers: fileTreeHeaders(cacheScope, cacheKey) });
  }

  const tree = await getFileTreeForSite(siteSlug, { includeSensitive });
  return Response.json(tree, { headers: fileTreeHeaders(cacheScope, cacheKey) });
}
