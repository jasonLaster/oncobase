import type { Metadata } from "next";
import {
  getCanonicalSlug,
  getMarkdownFile,
  type MarkdownFile,
} from "@/lib/markdown";

export const SITE_NAME = "TNBC Knowledge Base";
export const DEFAULT_SITE_DESCRIPTION =
  "Breast cancer research and treatment knowledge base";

const DESCRIPTION_MAX_LENGTH = 155;

export type MarkdownPageMetadata = {
  slug: string;
  title: string;
  description: string;
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

  return decoded.replace(/\.md$/i, "");
}

export async function getMarkdownFileForRoutePath(
  input: string,
): Promise<MarkdownFile | null> {
  const cleanPath = normalizeMarkdownRoutePath(input);
  const exactFile = await getMarkdownFile(cleanPath);
  if (exactFile) return exactFile;

  const canonicalPath = (await getCanonicalSlug(cleanPath)) ?? cleanPath;
  return await getMarkdownFile(canonicalPath);
}

export async function getMarkdownPageMetadata(
  routePath: string
): Promise<MarkdownPageMetadata | null> {
  const file = await getMarkdownFileForRoutePath(routePath);
  if (!file) return null;

  // `getMarkdownFile` now returns the same description Convex stores
  // alongside the doc — no separate description-map lookup needed.
  const frontmatterDescription =
    typeof file.frontmatter.description === "string"
      ? file.frontmatter.description.trim()
      : "";
  const description =
    truncateDescription(frontmatterDescription) ||
    deriveDescriptionFromContent(file) ||
    `${file.title} notes in ${SITE_NAME}`;

  return {
    slug: file.slug,
    title: file.title,
    description,
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
  };
}

export function formatDocumentTitle(title: string): string {
  return `${title} \u2014 ${SITE_NAME}`;
}

function deriveDescriptionFromContent(file: MarkdownFile): string | null {
  const paragraphs = file.content
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\n{2,}/)
    .map(cleanMarkdownParagraph)
    .filter(Boolean);

  const paragraph = paragraphs.find((text) => text.length >= 40) ?? paragraphs[0];
  return paragraph ? truncateDescription(paragraph) : null;
}

function cleanMarkdownParagraph(paragraph: string): string {
  const lines = paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^#{1,6}\s+/.test(line)) return false;
      if (/^\|/.test(line)) return false;
      if (/^[-:|\s]+$/.test(line)) return false;
      if (/\b(patient|dob|date of birth|mrn|medical record|diagnosed)\b/i.test(line)) {
        return false;
      }
      return true;
    });

  if (lines.length === 0) return "";

  return lines
    .join(" ")
    .replace(/^>\s*/gm, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[\[[^\]|]+\|([^\]]+)]]/g, "$1")
    .replace(/\[\[([^\]]+)]]/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
