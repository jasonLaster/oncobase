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
