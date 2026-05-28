import type { SiteData } from "@/lib/site-data";
import { applyPiiRedactions } from "@/lib/pii-redaction";
import { splitWikilinkAlias } from "@/lib/wikilinks";

export const CHAT_UNAVAILABLE_CONTENT = "unavailable";

type SiteDocument = NonNullable<
  Awaited<ReturnType<SiteData["documents"]["getBySlug"]>>
>;

type LinkedPage = {
  slug: string;
  title: string;
  href: string;
  anchor: string | undefined;
};

export type ChatReadPageResult =
  | {
      slug: string;
      title: string;
      href: string;
      anchor: string | undefined;
      tags: string[];
      content: string;
      linked_pages: LinkedPage[];
      unavailable?: true;
      sensitive?: boolean;
    }
  | { error: string };

function splitSlugAnchor(value: string) {
  const normalized = value.replace(/^\/+/, "").replace(/\.(?:md|mdx)(?=#|$)/, "");
  const hashIndex = normalized.indexOf("#");
  if (hashIndex === -1) return { slug: normalized, anchor: undefined };
  return {
    slug: normalized.slice(0, hashIndex),
    anchor: normalized.slice(hashIndex + 1) || undefined,
  };
}

function hrefForSlug(slug: string, anchor?: string) {
  return `/${slug}${anchor ? `#${anchor}` : ""}`;
}

async function resolveLinkedPages(
  siteData: SiteData,
  content: string,
  slug: string,
): Promise<LinkedPage[]> {
  const linkRegex = /\[\[([^\]]+?)\]\]/g;
  const linkedSlugs = new Set<string>();
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const linked = splitSlugAnchor(splitWikilinkAlias(match[1]).target);
    if (linked.slug === "about/Terminology" || linked.slug === slug) continue;
    linkedSlugs.add(hrefForSlug(linked.slug, linked.anchor).slice(1));
  }

  const slugsToResolve = Array.from(linkedSlugs).slice(0, 10);
  const linkedPages = await Promise.all(
    slugsToResolve.map(async (s) => {
      const linkedTarget = splitSlugAnchor(s);
      const linked = await siteData.documents.getBySlug({
        slug: linkedTarget.slug,
      });
      return linked
        ? {
            slug: linked.slug,
            title: applyPiiRedactions(linked.title),
            href: hrefForSlug(linked.slug, linkedTarget.anchor),
            anchor: linkedTarget.anchor,
          }
        : null;
    }),
  );

  return linkedPages.filter(
    (page): page is LinkedPage => page !== null,
  );
}

function redactedReadResult(
  doc: SiteDocument,
  anchor: string | undefined,
): Extract<ChatReadPageResult, { slug: string }> {
  return {
    slug: doc.slug,
    title: applyPiiRedactions(doc.title),
    href: hrefForSlug(doc.slug, anchor),
    anchor,
    tags: doc.tags,
    content: CHAT_UNAVAILABLE_CONTENT,
    linked_pages: [],
    unavailable: true,
    sensitive: doc.sensitive === true ? true : undefined,
  };
}

export async function readChatPage(
  siteData: SiteData,
  slug: string,
): Promise<ChatReadPageResult> {
  const requested = splitSlugAnchor(slug);
  const publicDoc = await siteData.documents.getBySlug({ slug: requested.slug });
  if (!publicDoc) {
    const unavailableDoc = await siteData.documents.getBySlug({
      slug: requested.slug,
      includeSensitive: true,
    });
    if (!unavailableDoc) return { error: `Page not found: ${requested.slug}` };
    return redactedReadResult(unavailableDoc, requested.anchor);
  }

  const content = applyPiiRedactions(publicDoc.content);

  return {
    slug: publicDoc.slug,
    title: applyPiiRedactions(publicDoc.title),
    href: hrefForSlug(publicDoc.slug, requested.anchor),
    anchor: requested.anchor,
    tags: publicDoc.tags,
    content: content.slice(0, 8000),
    linked_pages: await resolveLinkedPages(siteData, content, publicDoc.slug),
  };
}
