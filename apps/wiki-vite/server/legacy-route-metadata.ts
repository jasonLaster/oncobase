export const DIANA_SITE_NAME = "TNBC Knowledge Base";
export const DEFAULT_SITE_DESCRIPTION =
  "Breast cancer research and treatment knowledge base";

const DESCRIPTION_MAX_LENGTH = 155;

export type LegacyRouteMetadata = {
  description: string;
  openGraphDescription: string;
  openGraphTitle: string;
  openGraphType?: "article" | "website";
  title: string;
  twitterDescription: string;
  twitterTitle: string;
};

export function tagFromPathname(pathname: string) {
  if (!pathname.startsWith("/tags/")) return null;
  const encodedTag = pathname.slice("/tags/".length);
  try {
    return decodeURIComponent(encodedTag);
  } catch {
    return encodedTag;
  }
}

export function truncateLegacyDescription(description: string) {
  const trimmed = description.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= DESCRIPTION_MAX_LENGTH) return trimmed;

  const clipped = trimmed.slice(0, DESCRIPTION_MAX_LENGTH + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const end = lastSpace > 80 ? lastSpace : DESCRIPTION_MAX_LENGTH;
  return `${clipped.slice(0, end).replace(/[.,;:!?-]+$/, "")}...`;
}

export function legacyRouteMetadata({
  page,
  pathname,
  siteName,
  slug,
  tagCount,
}: {
  page: { description?: string | null; title: string } | null;
  pathname: string;
  siteName: string;
  slug: string | null;
  tagCount?: number | null;
}): LegacyRouteMetadata {
  if (pathname === "/terms-and-conditions") {
    const description = "Terms and conditions for the Diana TNBC Knowledge Base.";
    return {
      description,
      openGraphDescription: description,
      openGraphTitle: "Terms and Conditions",
      openGraphType: "website",
      title: `Terms and Conditions — ${siteName}`,
      twitterDescription: description,
      twitterTitle: "Terms and Conditions",
    };
  }

  if (slug === "index") {
    return {
      description: DEFAULT_SITE_DESCRIPTION,
      openGraphDescription: DEFAULT_SITE_DESCRIPTION,
      openGraphTitle: "Home",
      openGraphType: "website",
      title: `Home — ${siteName}`,
      twitterDescription: DEFAULT_SITE_DESCRIPTION,
      twitterTitle: siteName,
    };
  }

  const tag = tagFromPathname(pathname);
  if (tag) {
    const routeTitle = `Tag: ${tag}`;
    const description =
      tagCount == null
        ? `Pages tagged ${tag} in ${siteName}`
        : `${tagCount} pages tagged "${tag}"`;
    return {
      description,
      openGraphDescription: description,
      openGraphTitle: routeTitle,
      title: `${routeTitle} — ${siteName}`,
      twitterDescription: DEFAULT_SITE_DESCRIPTION,
      twitterTitle: siteName,
    };
  }

  if (pathname === "/search") {
    const description = "Search across all wiki pages";
    return {
      description,
      openGraphDescription: description,
      openGraphTitle: "Search",
      title: `Search — ${siteName}`,
      twitterDescription: DEFAULT_SITE_DESCRIPTION,
      twitterTitle: siteName,
    };
  }

  if (pathname === "/login" || !page) {
    return {
      description: DEFAULT_SITE_DESCRIPTION,
      openGraphDescription: DEFAULT_SITE_DESCRIPTION,
      openGraphTitle: siteName,
      openGraphType: "website",
      title: siteName,
      twitterDescription: DEFAULT_SITE_DESCRIPTION,
      twitterTitle: siteName,
    };
  }

  const description =
    truncateLegacyDescription(page.description ?? "") ||
    `${page.title} notes in ${siteName}`;
  return {
    description,
    openGraphDescription: description,
    openGraphTitle: page.title,
    openGraphType: "article",
    title: `${page.title} — ${siteName}`,
    twitterDescription: description,
    twitterTitle: page.title,
  };
}
