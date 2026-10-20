import { configuredRedirect } from "../src/route-canonicalization.ts";

export function legacyRedirectResponse(request: Request) {
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
  const redirect = configuredRedirect(url.pathname);
  if (!redirect) return null;
  const target = new URL(redirect.destination, request.url);
  target.search = url.search;
  return Response.redirect(target, redirect.permanent ? 308 : 307);
}
