import { canonicalSlugLookupEntriesFromSlugs } from "@oncobase/wiki-content/canonical-slugs";

const EXPLICIT_CANONICAL_PATHS = new Map([
  ["/admin/access", "/admin/pages"],
  ["/about", "/about/Index"],
  ["/about/index", "/about/Index"],
  ["/timeline", "/diagnostics"],
]);

function safeDecodePathname(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** The landing page and the sign-in page both live outside the wiki. */
export function isSignInPathname(pathname: string) {
  return pathname === "/login" || pathname === "/sign-in";
}

export function slugFromRoutePathname(pathname: string) {
  if (isSignInPathname(pathname)) return null;
  const decoded = safeDecodePathname(pathname)
    .replace(/^\/+/, "")
    .replace(/\.(?:md|mdx)$/i, "");
  return decoded || "index";
}

export function trailingSlashCanonicalPathname(pathname: string) {
  if (pathname === "/" || !pathname.endsWith("/") || pathname.startsWith("/api/")) {
    return null;
  }
  return pathname.replace(/\/+$/, "");
}

export function explicitCanonicalPathname(pathname: string) {
  const canonicalPath = EXPLICIT_CANONICAL_PATHS.get(pathname);
  return canonicalPath && canonicalPath !== pathname ? canonicalPath : null;
}

export function canonicalSlugPathname(
  pathname: string,
  canonicalSlugs: ReadonlyMap<string, string>,
) {
  const slug = slugFromRoutePathname(pathname);
  if (!slug || slug === "index") return null;
  const canonicalSlug = canonicalSlugs.get(slug.toLowerCase());
  if (!canonicalSlug || canonicalSlug === slug) return null;
  const canonicalPathname = `/${canonicalSlug}`;
  return canonicalPathname === pathname ? null : canonicalPathname;
}

export function canonicalSlugMap(slugs: string[]) {
  return new Map(canonicalSlugLookupEntriesFromSlugs(slugs));
}

/**
 * `configuredRedirectPathname` comes from `./configured-redirects`. It is a
 * parameter so the reader can load that table after paint: the server answers
 * cold loads of a legacy URL with its own redirect.
 */
export function canonicalRoutePathname(
  pathname: string,
  canonicalSlugs: ReadonlyMap<string, string>,
  configuredRedirectPathname: (pathname: string) => string | null = () => null,
) {
  let current = pathname;
  for (let redirectsFollowed = 0; redirectsFollowed < 8; redirectsFollowed += 1) {
    const next =
      configuredRedirectPathname(current) ??
      trailingSlashCanonicalPathname(current) ??
      explicitCanonicalPathname(current) ??
      canonicalSlugPathname(current, canonicalSlugs);
    if (!next || next === current) break;
    current = next;
  }
  return current === pathname ? null : current;
}
