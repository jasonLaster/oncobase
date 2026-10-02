import { isEducationSlug } from "./education-access";

export const EDUCATION_PREFIX = "wiki/education/";

export function isEducationHubPathname(pathname: string) {
  return pathname === "/education" || pathname.startsWith("/education/");
}

/** Public URLs keep the published wiki slugs as their content identifiers. */
export function educationSlugFromPathname(pathname: string): string | null {
  if (
    !isEducationHubPathname(pathname) ||
    ["/education", "/education/", "/education/search"].includes(pathname)
  )
    return null;
  try {
    const relative = decodeURIComponent(pathname.slice("/education/".length))
      .replace(/\.(?:md|mdx)$/i, "")
      .replace(/\/$/, "");
    const slug = `${EDUCATION_PREFIX}${relative}`;
    return isEducationSlug(slug) ? slug : null;
  } catch {
    return null;
  }
}

export function educationHref(slug: string) {
  return `/education/${slug.slice(EDUCATION_PREFIX.length).split("/").map(encodeURIComponent).join("/")}`;
}

/** Rewrite curriculum links after the shared renderer resolves wiki syntax. */
export function educationLinkHref(
  href: string | undefined,
  currentSlug?: string,
) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  if (href.startsWith("/api/file?"))
    return href.replace("/api/file?", "/api/education/file?");
  if (
    href.startsWith("/api/") ||
    isEducationHubPathname(href.split(/[?#]/)[0]!)
  )
    return href;
  const [, pathname, suffix] = href.match(/^([^?#]*)(.*)$/s)!;
  let path: string;
  try {
    path = decodeURIComponent(pathname!).replace(/\.(?:md|mdx)$/i, "");
  } catch {
    return href;
  }
  let slug: string;
  if (path.startsWith("/")) slug = path.slice(1);
  else if (path.startsWith("wiki/")) slug = path;
  else {
    const directory =
      currentSlug?.split("/").slice(0, -1).join("/") ?? EDUCATION_PREFIX;
    try {
      slug = decodeURIComponent(
        new URL(path, `https://education.invalid/${directory}/`).pathname.slice(
          1,
        ),
      );
    } catch {
      return href;
    }
  }
  return isEducationSlug(slug) ? `${educationHref(slug)}${suffix}` : href;
}
