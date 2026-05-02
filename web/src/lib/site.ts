// Helpers for reading the active site from a request. Always prefer
// these to ad-hoc `request.headers.get("x-site-slug")` so the
// `requireSite(ctx, slug)` Convex contract is consistent everywhere.

import { headers } from "next/headers";

export const DEFAULT_SITE_SLUG = "diana";
const SITE_SLUG_RE = /^[a-z0-9-]{1,32}$/;

declare const siteSlugBrand: unique symbol;
export type SiteSlug = string & { readonly [siteSlugBrand]: true };

export function toSiteSlug(slug: string): SiteSlug {
  if (!SITE_SLUG_RE.test(slug)) {
    throw new Error(`invalid siteSlug: ${slug}`);
  }
  return slug as SiteSlug;
}

/**
 * Read the active siteSlug from the proxy-set `x-site-slug` header
 * on a Server Component / route-handler request.
 *
 * Falls back to the default site if the header is missing — that
 * happens for routes excluded from the proxy matcher (`/api/file`,
 * `/api/share-preview`, `/api/post-deploy`, the workflow webhook).
 * In those cases the route still needs SOMETHING; the default is
 * the safest choice during the Diana migration window.
 */
export async function getRequestSiteSlug(): Promise<SiteSlug> {
  const h = await headers();
  return toSiteSlug(h.get("x-site-slug") ?? DEFAULT_SITE_SLUG);
}

/** Synchronous version for use inside route handlers that already
 * have the NextRequest object — saves the async headers() call. */
export function siteSlugFromRequest(request: { headers: Headers }): SiteSlug {
  return toSiteSlug(request.headers.get("x-site-slug") ?? DEFAULT_SITE_SLUG);
}
