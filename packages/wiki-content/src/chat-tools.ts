import { applyPiiRedactions, type PiiPattern } from "@diana-tnbc/wiki-content/pii";

export const CHAT_UNAVAILABLE_CONTENT = "unavailable";

type SiteDocument = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  sensitive?: boolean;
};

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

export type ChatPageDocumentsGateway = {
  getBySlug(args: { slug: string; includeSensitive?: boolean }): Promise<SiteDocument | null>;
};

function splitWikilinkAlias(inner: string) {
  const pipeIndex = inner.indexOf("|");
  if (pipeIndex === -1) return { target: inner.trim(), display: inner.trim() };
  return {
    target: inner.slice(0, pipeIndex).trim(),
    display: inner.slice(pipeIndex + 1).trim(),
  };
}

function splitSlugAnchor(value: string) {
  const normalized = value.replace(/^\/+/, "").replace(/\.md(?=#|$)/, "");
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
  documents: ChatPageDocumentsGateway,
  content: string,
  slug: string,
  patterns?: PiiPattern[],
): Promise<LinkedPage[]> {
  const linkRegex = /\[\[([^\]]+?)\]\]/g;
  const linkedSlugs = new Set<string>();
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const linked = splitSlugAnchor(splitWikilinkAlias(match[1]).target);
    if (linked.slug === "about/Terminology" || linked.slug === slug) continue;
    linkedSlugs.add(hrefForSlug(linked.slug, linked.anchor).slice(1));
  }

  const linkedPages = await Promise.all(
    Array.from(linkedSlugs)
      .slice(0, 10)
      .map(async (linkedSlug) => {
        const target = splitSlugAnchor(linkedSlug);
        const linked = await documents.getBySlug({ slug: target.slug });
        return linked
          ? {
              slug: linked.slug,
              title: applyPiiRedactions(linked.title, { patterns }),
              href: hrefForSlug(linked.slug, target.anchor),
              anchor: target.anchor,
            }
          : null;
      }),
  );

  return linkedPages.filter((page): page is LinkedPage => page !== null);
}

function redactedReadResult(
  doc: SiteDocument,
  anchor: string | undefined,
  patterns?: PiiPattern[],
): Extract<ChatReadPageResult, { slug: string }> {
  return {
    slug: doc.slug,
    title: applyPiiRedactions(doc.title, { patterns }),
    href: hrefForSlug(doc.slug, anchor),
    anchor,
    tags: doc.tags,
    content: CHAT_UNAVAILABLE_CONTENT,
    linked_pages: [],
    unavailable: true,
    sensitive: doc.sensitive === true ? true : undefined,
  };
}

export async function readChatPageFromDocuments(
  documents: ChatPageDocumentsGateway,
  slug: string,
  options: { patterns?: PiiPattern[] } = {},
): Promise<ChatReadPageResult> {
  const requested = splitSlugAnchor(slug);
  const publicDoc = await documents.getBySlug({ slug: requested.slug });
  if (!publicDoc) {
    const unavailableDoc = await documents.getBySlug({
      slug: requested.slug,
      includeSensitive: true,
    });
    if (!unavailableDoc) return { error: `Page not found: ${requested.slug}` };
    return redactedReadResult(unavailableDoc, requested.anchor, options.patterns);
  }

  const content = applyPiiRedactions(publicDoc.content, { patterns: options.patterns });

  return {
    slug: publicDoc.slug,
    title: applyPiiRedactions(publicDoc.title, { patterns: options.patterns }),
    href: hrefForSlug(publicDoc.slug, requested.anchor),
    anchor: requested.anchor,
    tags: publicDoc.tags,
    content: content.slice(0, 8000),
    linked_pages: await resolveLinkedPages(
      documents,
      content,
      publicDoc.slug,
      options.patterns,
    ),
  };
}
