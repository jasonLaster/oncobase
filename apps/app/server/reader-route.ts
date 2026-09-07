import { isLinkPreviewBotUserAgent } from "@oncobase/wiki-content/link-preview";
import { configuredRedirect, explicitCanonicalPathname, slugFromRoutePathname, trailingSlashCanonicalPathname } from "../src/route-canonicalization";
import { specialRouteMetadata } from "../src/special-route-metadata";
import { DEFAULT_SITE_DESCRIPTION, DIANA_SITE_NAME } from "./legacy-route-metadata";

export function readerSlug(request: Request) {
  const url = new URL(request.url), pathname = url.pathname;
  if ((request.method !== "GET" && request.method !== "HEAD") || url.searchParams.get("html-first") === "off" ||
    /^\/(?:api|assets|tags|admin|tools|diagnostics|chat)(?:\/|$)/.test(pathname) ||
    ["/login", "/search", "/robots.txt", "/favicon.svg"].includes(pathname) ||
    /\.(?!mdx?$)[a-z0-9]+$/i.test(pathname) ||
    trailingSlashCanonicalPathname(pathname) || explicitCanonicalPathname(pathname) || configuredRedirect(pathname) ||
    isLinkPreviewBotUserAgent(request.headers.get("user-agent")) ||
    specialRouteMetadata({ pathname, siteName: DIANA_SITE_NAME, defaultDescription: DEFAULT_SITE_DESCRIPTION })) return null;
  return slugFromRoutePathname(pathname);
}
