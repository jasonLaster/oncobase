import type { WikiSessionIdentity } from "@oncobase/wiki-content";
import type { PageContentRow, SiteStateRow } from "../types";

/** Longest the cached public page stays up once the session store is running. */
export const SESSION_HANDOFF_TIMEOUT_MS = 4_000;

/**
 * The one identity change that may keep a cached presentation mounted: a
 * public page meeting a verified session on the same site. Public content was
 * on screen either way, and nothing private appears until the session store
 * replaces it. Any other change (another account, session to public, a new
 * public partition) still unmounts at once.
 */
export function keepsPresentationMounted(presented: WikiSessionIdentity, verified: WikiSessionIdentity) {
  return presented.scope === "public" && !presented.authenticated && presented.userHash === null &&
    verified.scope === "session" && verified.authenticated && Boolean(verified.userHash) &&
    presented.siteSlug === verified.siteSlug;
}

/**
 * The session store can replace the presentation without a pending frame once
 * it has a validated manifest (navigation) and a settled body for the route:
 * content, or the terminal state the reader would render instead.
 */
export function sessionRouteReady(slug: string, page: PageContentRow | null | undefined, state: SiteStateRow | null | undefined) {
  if (!state?.manifestHash || page?.slug !== slug) return false;
  return Boolean(page.content || page.missingAt != null ||
    page.contentStatus === "deleted" || page.contentStatus === "missing" || page.contentStatus === "sensitive-unavailable");
}
