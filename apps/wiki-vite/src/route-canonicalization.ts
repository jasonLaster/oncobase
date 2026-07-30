import { canonicalSlugLookupEntriesFromSlugs } from "@oncobase/wiki-content/canonical-slugs";
import redirects from "../../web/redirects.json";

export type RedirectEntry = {
  source: string;
  destination: string;
  permanent?: boolean;
};

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

export function slugFromRoutePathname(pathname: string) {
  if (pathname === "/login") return null;
  const decoded = safeDecodePathname(pathname)
    .replace(/^\/+/, "")
    .replace(/\.(?:md|mdx)$/i, "");
  return decoded || "index";
}

export function matchConfiguredRedirect(
  pathname: string,
  entry: RedirectEntry,
) {
  if (!entry.source.includes(":path*")) {
    return pathname === entry.source ? entry.destination : null;
  }

  const sourcePrefix = entry.source.slice(0, entry.source.indexOf(":path*"));
  if (!pathname.startsWith(sourcePrefix)) return null;
  const rest = pathname.slice(sourcePrefix.length);
  return entry.destination.replace(":path*", rest);
}

export function configuredRedirect(pathname: string) {
  for (const entry of redirects as RedirectEntry[]) {
    const destination = matchConfiguredRedirect(pathname, entry);
    if (destination) return { destination, permanent: entry.permanent === true };
  }
  return null;
}

export function configuredRedirectPathname(pathname: string) {
  return configuredRedirect(pathname)?.destination ?? null;
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

export function canonicalRoutePathname(
  pathname: string,
  canonicalSlugs: ReadonlyMap<string, string>,
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
