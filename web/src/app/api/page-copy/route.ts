import { getMarkdownFileForSite, type MarkdownFile } from "@/lib/markdown";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteSlugFromRequest } from "@/lib/site";

const PUBLIC_COPY_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const PRIVATE_COPY_CACHE_CONTROL =
  "private, max-age=60, stale-while-revalidate=3600";

function isSafeSlug(slug: string) {
  return (
    slug.length > 0 &&
    slug.length <= 1024 &&
    !slug.includes("\0") &&
    !slug.startsWith("/") &&
    !slug.split("/").some((segment) => segment === "..")
  );
}

function cacheKeyPart(value: string) {
  return value.replace(/[^A-Za-z0-9:._/-]/g, "_").slice(0, 512);
}

function copyHeaders(
  file: MarkdownFile,
  cacheScope: "public" | "private",
  cacheKey: string,
) {
  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control":
      cacheScope === "public"
        ? PUBLIC_COPY_CACHE_CONTROL
        : PRIVATE_COPY_CACHE_CONTROL,
    Vary:
      cacheScope === "public"
        ? "Accept, x-site-slug"
        : "Accept, Cookie, x-site-slug",
    "X-Page-Copy-Cache": cacheScope,
    "X-Page-Copy-Cache-Key": cacheKey,
  });

  if (file.contentHash) {
    headers.set("ETag", `W/"${file.contentHash}"`);
    headers.set("X-Content-Hash", file.contentHash);
  }

  return headers;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const requestedCacheKey = cacheKeyPart(
    url.searchParams.get("cacheKey") ?? "latest",
  );
  if (!isSafeSlug(slug)) {
    return new Response("Invalid slug", { status: 400 });
  }

  const siteSlug = siteSlugFromRequest(request);
  const publicFile = await getMarkdownFileForSite(siteSlug, slug, {
    includeSensitive: false,
  });
  if (publicFile) {
    return new Response(publicFile.content, {
      headers: copyHeaders(
        publicFile,
        "public",
        `${siteSlug}:public:${cacheKeyPart(publicFile.slug)}:${requestedCacheKey}`,
      ),
    });
  }

  const sessionUser = await getSessionUserFromRequest(request);
  if (!sessionUser) {
    return new Response("Not found", { status: 404 });
  }

  const privateFile = await getMarkdownFileForSite(siteSlug, slug, {
    includeSensitive: true,
  });
  if (!privateFile) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(privateFile.content, {
    headers: copyHeaders(
      privateFile,
      "private",
      `${siteSlug}:session:${sessionUser._id}:${cacheKeyPart(privateFile.slug)}:${requestedCacheKey}`,
    ),
  });
}
