import type { Metadata } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import {
  getCanonicalSlug,
  getMarkdownFile,
  type MarkdownFile,
} from "@/lib/markdown";

export const SITE_NAME = "Diana's TNBC";
export const DEFAULT_SITE_DESCRIPTION =
  "Breast cancer research and treatment knowledge base";

const DESCRIPTION_MAX_LENGTH = 155;

export type MarkdownPageMetadata = {
  slug: string;
  title: string;
  description: string;
};

async function getDescriptionMap(): Promise<Map<string, string>> {
  "use cache";

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return new Map();
  try {
    const convex = new ConvexHttpClient(convexUrl);
    const map = new Map<string, string>();
    let cursor: string | null = null;
    let isDone = false;
    const t0 = Date.now();
    while (!isDone) {
      const page = await convex.query(api.documents.listPageDescriptions, {
        cursor,
        numItems: 100,
      }) as {
        page: Array<{ slug: string; description: string | null }>;
        isDone: boolean;
        continueCursor: string;
      };
      for (const { slug, description } of page.page) {
        if (description) map.set(slug, description);
      }
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    console.log(`[build] descriptions loaded: ${map.size} in ${Date.now() - t0}ms`);
    return map;
  } catch (err) {
    console.warn("[build] failed to load descriptions:", err);
    return new Map();
  }
}

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

export function getMarkdownFileForRoutePath(input: string): MarkdownFile | null {
  const cleanPath = normalizeMarkdownRoutePath(input);
  const canonicalPath = getCanonicalSlug(cleanPath) ?? cleanPath;
  return getMarkdownFile(canonicalPath);
}

export async function getMarkdownPageMetadata(
  routePath: string
): Promise<MarkdownPageMetadata | null> {
  const file = getMarkdownFileForRoutePath(routePath);
  if (!file) return null;

  const frontmatterDescription =
    typeof file.frontmatter.description === "string"
      ? file.frontmatter.description.trim()
      : "";
  const storedDescription = (await getDescriptionMap()).get(file.slug);
  const description =
    truncateDescription(frontmatterDescription || storedDescription || "") ||
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
