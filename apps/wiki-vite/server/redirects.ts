import { configuredRedirect } from "../src/route-canonicalization.ts";

export function legacyRedirectResponse(request: Request) {
  const url = new URL(request.url);
  const redirect = configuredRedirect(url.pathname);
  if (!redirect) return null;
  const target = new URL(redirect.destination, request.url);
  target.search = url.search;
  return Response.redirect(target, redirect.permanent ? 308 : 307);
}
