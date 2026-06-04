import type { Metadata } from "next";
import {
  resolveMarkdownManifestRouteForSite,
  type MarkdownManifest,
} from "@/lib/markdown";
import { getRequestSiteSlug, type SiteSlug } from "@/lib/site";

export const SITE_NAME = "TNBC Knowledge Base";
export const DEFAULT_SITE_DESCRIPTION =
  "Breast cancer research and treatment knowledge base";

const DESCRIPTION_MAX_LENGTH = 155;

export type MarkdownPageMetadata = {
  slug: string;
  title: string;
  description: string;
  sensitive: boolean;
};

type MarkdownPageMetadataOptions = {
  includeSensitive?: boolean;
};

export function normalizeMarkdownRoutePath(input: string): string {
  const pathname = input.split("?")[0]?.replace(/^\/+/, "") ?? "";
  const decoded = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");

  return decoded.replace(/\.(?:md|mdx)$/i, "");
}

export async function getMarkdownFileForRoutePath(
  input: string,
  { includeSensitive = false }: MarkdownPageMetadataOptions = {},
): Promise<MarkdownManifest | null> {
  const siteSlug = await getRequestSiteSlug();
  return getMarkdownFileForRoutePathForSite(siteSlug, input, {
    includeSensitive,
  });
}

export async function getMarkdownFileForRoutePathForSite(
  siteSlug: SiteSlug,
  input: string,
  { includeSensitive = false }: MarkdownPageMetadataOptions = {},
): Promise<MarkdownManifest | null> {
  const cleanPath = normalizeMarkdownRoutePath(input);
  const { manifest } = await resolveMarkdownManifestRouteForSite(siteSlug, cleanPath, {
    includeSensitive,
  });
  return manifest;
}

export async function getMarkdownPageMetadata(
  routePath: string,
  options: MarkdownPageMetadataOptions = {},
): Promise<MarkdownPageMetadata | null> {
  const siteSlug = await getRequestSiteSlug();
  return getMarkdownPageMetadataForSite(siteSlug, routePath, options);
}

export async function getMarkdownPageMetadataForSite(
  siteSlug: SiteSlug,
  routePath: string,
  options: MarkdownPageMetadataOptions = {},
): Promise<MarkdownPageMetadata | null> {
  const manifest = await getMarkdownFileForRoutePathForSite(siteSlug, routePath, options);
  if (!manifest) return null;

  // `getMarkdownFile` now returns the same description Convex stores
  // alongside the doc — no separate description-map lookup needed.
  const frontmatterDescription =
    typeof manifest.frontmatter.description === "string"
      ? manifest.frontmatter.description.trim()
      : "";
  const description =
    truncateDescription(frontmatterDescription) ||
    `${manifest.title} notes in ${SITE_NAME}`;

  return {
    slug: manifest.slug,
    title: manifest.title,
    description,
    sensitive: manifest.sensitive === true,
  };
}

export function toNextMetadata(page: MarkdownPageMetadata): Metadata {
  return {
    title: page.title,
    description: page.description,
    openGraph: {
      title: page.title,
      description: page.description,
      type: "article",
      siteName: SITE_NAME,
    },
    twitter: {
      card: "summary",
      title: page.title,
      description: page.description,
    },
    robots: page.sensitive ? { index: false, follow: false } : undefined,
  };
}

export function formatDocumentTitle(title: string): string {
  return `${title} \u2014 ${SITE_NAME}`;
}

function truncateDescription(description: string): string {
  const trimmed = description.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= DESCRIPTION_MAX_LENGTH) return trimmed;

  const clipped = trimmed.slice(0, DESCRIPTION_MAX_LENGTH + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const end = lastSpace > 80 ? lastSpace : DESCRIPTION_MAX_LENGTH;
  return `${clipped.slice(0, end).replace(/[.,;:!?-]+$/, "")}...`;
}
