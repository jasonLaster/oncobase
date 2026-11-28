// Paths the reader's router gives to an application page rather than to a
// published wiki page (`src/App.tsx`, `src/ImmersiveDicomRoot.tsx`). The
// server uses this to skip page lookups that can never apply: a miscased-slug
// redirect for `/chat` would need the site's whole page listing, and no wiki
// page can render there anyway. `reader-app-routes.test.ts` keeps this list in
// step with the routers.
export const READER_APP_ROUTES = [
  "/search",
  "/table-examples",
  "/diagnostics",
  "/diagnostics/imaging",
  "/diagnostics/cellularity",
  "/chat",
  "/chat/:id",
  "/comments",
  "/tags/:tag",
  "/tools",
  "/tools/single-cell",
  "/tools/medical-deduction",
  "/tools/dicom-viewer",
  "/tools/dicom-compare",
  "/access",
  "/admin",
  "/admin/*",
  "/pii-view/*",
] as const;

const MATCHERS = READER_APP_ROUTES.map(route => {
  const segments = route.split("/").slice(1);
  const splat = segments.at(-1) === "*";
  return { segments: splat ? segments.slice(0, -1) : segments, splat };
});

/** True when `pathname` is one of the reader's application routes. Matching
 * ignores case, as React Router's does by default. */
export function isReaderAppRoute(pathname: string) {
  const segments = pathname.toLowerCase().split("/").slice(1);
  return MATCHERS.some(({ segments: pattern, splat }) => {
    if (splat ? segments.length < pattern.length : segments.length !== pattern.length) return false;
    return pattern.every((part, index) => part.startsWith(":") ? segments[index] !== "" : part === segments[index]);
  });
}
