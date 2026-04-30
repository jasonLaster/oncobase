// Helpers for reading the active site from a request. Always prefer
// these to ad-hoc `request.headers.get("x-site-slug")` so the
// `requireSite(ctx, slug)` Convex contract is consistent everywhere.

import { headers } from "next/headers";

export const DEFAULT_SITE_SLUG = "diana";

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
export async function getRequestSiteSlug(): Promise<string> {
  const h = await headers();
  return h.get("x-site-slug") ?? DEFAULT_SITE_SLUG;
}

/** Synchronous version for use inside route handlers that already
 * have the NextRequest object — saves the async headers() call. */
export function siteSlugFromRequest(request: { headers: Headers }): string {
  return request.headers.get("x-site-slug") ?? DEFAULT_SITE_SLUG;
}
