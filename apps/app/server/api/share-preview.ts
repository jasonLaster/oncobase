import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { getDocumentsByTag } from "../document-listing";
import { slugFromRoutePathname } from "../../src/route-canonicalization.js";
import { landingRouteMetadata } from "../../src/special-route-metadata.js";
import {
  DEFAULT_SITE_DESCRIPTION,
  DIANA_SITE_NAME as SITE_NAME,
  legacyRouteMetadata,
  tagFromPathname,
} from "../legacy-route-metadata.js";
import { DEFAULT_SITE_SLUG, withSiteSlug } from "../reader-access";
import { applyPiiRedactions, parseSitePiiPatterns } from "@oncobase/wiki-content/pii";
import { pageDescription, pageSocialImageUrl } from "../page-social-metadata";
import { educationSlugFromPathname, isEducationHubPathname } from "../../src/education-routes";

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

  const { siteName, title, description, ogTitle, ogDescription, ogType, ogImage, twitterTitle, twitterDescription, hasPageCard } =
    await sharePreviewMetadata(request, client, siteSlug);

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
    ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">
    <meta property="og:image:alt" content="${escapeHtml(ogTitle)}">` : ""}
    ${hasPageCard ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ""}
    <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
    <meta name="twitter:title" content="${escapeHtml(twitterTitle)}">
    <meta name="twitter:description" content="${escapeHtml(twitterDescription)}">
    ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ""}
  </head>
  <body></body>
</html>`;

  return new Response(request.method === "HEAD" ? null : html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-site-slug": siteSlug,
      "Cache-Control": "private, no-store",
      Vary: "Host",
    },
  });
}

/** Always resolves the public projection, even when the caller has a session. */
export async function sharePreviewMetadata(request: Request, client: ConvexHttpClient, siteSlug: string) {
  const url = new URL(request.url);
  const routePath =
    request.headers.get("x-share-preview-path") ??
    url.searchParams.get("path") ??
    "/";
  const pathname = routePath.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/";
  const slug = isEducationHubPathname(pathname)
    ? educationSlugFromPathname(pathname) : slugFromRoutePathname(pathname);
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
  const [site, publicPage, taggedPages] = await Promise.all([
    client.query(api.sites.getBySlug, { slug: siteSlug }).catch(() => null),
    linkedPage().catch(() => null),
    tag
      ? getDocumentsByTag(client, withSiteSlug(siteSlug, { tag })).catch(() => null)
      : Promise.resolve(null),
  ]);
  // Preview copy and the generated image must share the anonymous PII policy.
  // If configuration cannot be read, omit page data rather than guessing it.
  const configured = parseSitePiiPatterns(site?.config?.piiPatterns);
  const patterns = configured.length ? configured : siteSlug === DEFAULT_SITE_SLUG ? undefined : [];
  const redact = (text: string) => applyPiiRedactions(text, { patterns });
  const page = site && publicPage && publicPage.sensitive !== true ? {
    ...publicPage,
    title: redact(publicPage.title),
    description: publicPage.description ? redact(publicPage.description) : null,
    content: redact(publicPage.content ?? ""),
  } : null;
  const isDiana = siteSlug === DEFAULT_SITE_SLUG;
  let siteName: string;
  let title: string;
  let description: string;
  let ogTitle: string;
  let ogDescription: string;
  let ogType: "article" | "website" | undefined;
  let ogImage: string | undefined;
  let twitterTitle: string;
  let twitterDescription: string;

  if (isDiana) {
    siteName = SITE_NAME;
    // A shared bare domain opens the landing page for anyone signed out.
    const metadata = pathname === "/" ? landingRouteMetadata() : legacyRouteMetadata({
      page: page && { ...page, description: pageDescription(page, siteName) },
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
    ogImage = metadata.openGraphImage && new URL(metadata.openGraphImage, request.url).toString();
    twitterTitle = metadata.twitterTitle;
    twitterDescription = metadata.twitterDescription;
  } else {
    siteName = site?.config.title ?? site?.name ?? siteSlug;
    title = page ? `${page.title} — ${siteName}` : siteName;
    description = page
      ? pageDescription(page, siteName)
      : site?.config.description ?? DEFAULT_SITE_DESCRIPTION;
    ogTitle = page?.title ?? siteName;
    ogDescription = description;
    ogType = page ? "article" : "website";
    twitterTitle = ogTitle;
    twitterDescription = description;
  }
  const hasPageCard = Boolean(page && ogType === "article");
  if (hasPageCard) ogImage = pageSocialImageUrl(request.url, pathname);
  return { siteName, title, description, ogTitle, ogDescription, ogType, ogImage, twitterTitle, twitterDescription, hasPageCard };
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
