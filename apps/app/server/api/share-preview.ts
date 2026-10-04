import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { slugFromRoutePathname } from "../../src/route-canonicalization.js";
import {
  DEFAULT_SITE_DESCRIPTION,
  DIANA_SITE_NAME as SITE_NAME,
  legacyRouteMetadata,
  tagFromPathname,
  truncateLegacyDescription,
} from "../legacy-route-metadata.js";
import { DEFAULT_SITE_SLUG, withSiteSlug } from "../reader-access";

export async function handleSharePreviewRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const routePath =
    request.headers.get("x-share-preview-path") ??
    url.searchParams.get("path") ??
    "/";
  const pathname = routePath.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/";
  const slug = slugFromRoutePathname(pathname);
  const tag = tagFromPathname(pathname);
  async function linkedPage() {
    if (!slug) return null;
    const page = await client.query(
      api.documents.getBySlug,
      withSiteSlug(siteSlug, { slug }),
    );
    if (page || slug === "index" || slug.endsWith("/index")) return page;
    return client.query(
      api.documents.getBySlug,
      withSiteSlug(siteSlug, { slug: `${slug}/index` }),
    );
  }
  const [site, page, taggedPages] = await Promise.all([
    client.query(api.sites.getBySlug, { slug: siteSlug }).catch(() => null),
    linkedPage().catch(() => null),
    tag
      ? client
          .action(
            api.documents.getByTag,
            withSiteSlug(siteSlug, { tag }),
          )
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const isDiana = siteSlug === DEFAULT_SITE_SLUG;
  let siteName: string;
  let title: string;
  let description: string;
  let ogTitle: string;
  let ogDescription: string;
  let ogType: "article" | "website" | undefined;
  let twitterTitle: string;
  let twitterDescription: string;

  if (isDiana) {
    siteName = SITE_NAME;
    const metadata = legacyRouteMetadata({
      page,
      pathname,
      siteName,
      slug,
      tagCount: taggedPages?.length,
    });
    title = metadata.title;
    description = metadata.description;
    ogTitle = metadata.openGraphTitle;
    ogDescription = metadata.openGraphDescription;
    ogType = metadata.openGraphType;
    twitterTitle = metadata.twitterTitle;
    twitterDescription = metadata.twitterDescription;
  } else {
    siteName = site?.config.title ?? site?.name ?? siteSlug;
    title = page ? `${page.title} — ${siteName}` : siteName;
    description = page
      ? truncateLegacyDescription(page.description ?? "") || `${page.title} notes in ${siteName}`
      : site?.config.description ?? DEFAULT_SITE_DESCRIPTION;
    ogTitle = page?.title ?? siteName;
    ogDescription = description;
    ogType = page ? "article" : "website";
    twitterTitle = ogTitle;
    twitterDescription = description;
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex,nofollow">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:title" content="${escapeHtml(ogTitle)}">
    <meta property="og:description" content="${escapeHtml(ogDescription)}">
    ${ogType ? `<meta property="og:type" content="${ogType}">` : ""}
    <meta property="og:site_name" content="${escapeHtml(siteName)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${escapeHtml(twitterTitle)}">
    <meta name="twitter:description" content="${escapeHtml(twitterDescription)}">
  </head>
  <body></body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-site-slug": siteSlug,
      "Cache-Control": "private, no-store",
      Vary: "Host",
    },
  });
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
