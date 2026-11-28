/** Reader routes that are app screens rather than wiki pages. Kept apart from
 * Navigation so small floating chrome can ask without importing the sidebar. */
const NON_DOCUMENT_ROUTE_PREFIXES = [
  "/access",
  "/admin",
  "/chat",
  "/comments",
  "/diagnostics",
  "/login",
  "/pii-view",
  "/search",
  "/sign-in",
  "/table-examples",
  "/tags",
  "/timeline",
  "/tools",
] as const;

export function pathnameMatchesRoutePrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isDocumentRoute(pathname: string) {
  return !NON_DOCUMENT_ROUTE_PREFIXES.some((prefix) => pathnameMatchesRoutePrefix(pathname, prefix));
}

/** App pages that have no wiki markdown but can still be talked through. Their
 * text comes from the page's own data (see talk/talk-pages.ts). */
export const TALK_APP_ROUTES = ["/diagnostics/cellularity", "/tools/single-cell"] as const;

export function isTalkRoute(pathname: string) {
  return isDocumentRoute(pathname) || TALK_APP_ROUTES.some((route) => pathname === route);
}
