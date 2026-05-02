import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { DEFAULT_SITE_SLUG, siteSlugFromRequest } from "@/lib/site";
import {
  DEFAULT_SITE_DESCRIPTION,
  formatDocumentTitle,
  getMarkdownPageMetadata,
  SITE_NAME,
} from "@/lib/page-metadata";

// Multi-site share-preview: link-preview bots (Slack, Twitter, etc.)
// fetch this endpoint via a proxy.ts rewrite that preserves the
// `x-site-slug` header. Without site-scoping, every site's link
// previews would render Diana's SITE_NAME — see R2 in
// plans/multi-tenant-wiki/risk-assessment.md.
//
// Diana keeps the legacy fs-backed metadata loader during the
// migration window (markdown.ts is the deferred Phase 7 swap).
// Other sites get OG metadata from the Convex `sites.config`
// title/description, with the document title still from Convex if
// available — but we don't dig into the document body for them yet
// because the renderer is still fs-only.

type SiteOg = { title: string; description: string };

async function siteOgFromConvex(siteSlug: string): Promise<SiteOg | null> {
  try {
    const site = await getConvexServerClient().query(api.sites.getBySlug, {
      slug: siteSlug,
    });
    if (!site) return null;
    return {
      title: site.config.title ?? site.name,
      description: site.config.description ?? DEFAULT_SITE_DESCRIPTION,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const routePath =
    request.headers.get("x-share-preview-path") ??
    url.searchParams.get("path") ??
    "/";

  const siteSlug = siteSlugFromRequest(request);
  const isDiana = siteSlug === DEFAULT_SITE_SLUG;

  let title: string;
  let description: string;
  let ogTitle: string;
  let siteName: string;

  if (isDiana) {
    const page = await getMarkdownPageMetadata(routePath);
    title = page ? formatDocumentTitle(page.title) : SITE_NAME;
    description = page?.description ?? DEFAULT_SITE_DESCRIPTION;
    ogTitle = page?.title ?? SITE_NAME;
    siteName = SITE_NAME;
  } else {
    const og = (await siteOgFromConvex(siteSlug)) ?? {
      title: siteSlug,
      description: DEFAULT_SITE_DESCRIPTION,
    };
    title = og.title;
    description = og.description;
    ogTitle = og.title;
    siteName = og.title;
  }

  const canonicalPath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const canonicalUrl = new URL(canonicalPath, url.origin).toString();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex,nofollow">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:title" content="${escapeHtml(ogTitle)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="${escapeHtml(siteName)}">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  </head>
  <body></body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-site-slug": siteSlug,
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
