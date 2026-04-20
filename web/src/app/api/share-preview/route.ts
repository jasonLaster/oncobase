import { NextResponse } from "next/server";
import {
  DEFAULT_SITE_DESCRIPTION,
  formatDocumentTitle,
  getMarkdownPageMetadata,
  SITE_NAME,
} from "@/lib/page-metadata";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const routePath =
    request.headers.get("x-share-preview-path") ??
    url.searchParams.get("path") ??
    "/";
  const page = await getMarkdownPageMetadata(routePath);

  const title = page ? formatDocumentTitle(page.title) : SITE_NAME;
  const description = page?.description ?? DEFAULT_SITE_DESCRIPTION;
  const ogTitle = page?.title ?? SITE_NAME;
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
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
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
