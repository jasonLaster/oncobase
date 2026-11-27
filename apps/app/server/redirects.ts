import { configuredRedirect } from "../src/configured-redirects.ts";

const DEFAULT_SITE_SLUG = "diana";

export function legacyRedirectResponse(request: Request, siteSlug: string = DEFAULT_SITE_SLUG) {
  const url = new URL(request.url);
  if (/\.pdf$/i.test(url.pathname) && !url.pathname.startsWith("/api/")) {
    try {
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const target = new URL("/api/file", request.url);
      target.searchParams.set("path", path);
      for (const name of ["download", "raw"]) {
        if (url.searchParams.has(name)) target.searchParams.set(name, "1");
      }
      return Response.redirect(target, 302);
    } catch { return null; }
  }
  if (siteSlug !== DEFAULT_SITE_SLUG) return null;
  const redirect = configuredRedirect(url.pathname);
  if (!redirect) return null;
  const target = new URL(redirect.destination, request.url);
  target.search = url.search;
  return Response.redirect(target, redirect.permanent ? 308 : 307);
}
