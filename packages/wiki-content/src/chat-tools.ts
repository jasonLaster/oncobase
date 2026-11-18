import { slug as headingSlug } from "github-slugger";
import { applyPiiRedactions, type PiiPattern } from "./pii.ts";

export const CHAT_UNAVAILABLE_CONTENT = "unavailable";
/** Characters of page text one read_page call returns. Longer pages come back
 * in windows with an outline, so the model knows what it has not seen yet. */
export const CHAT_READ_PAGE_MAX_CHARS = 12_000;
const MAX_OUTLINE_SECTIONS = 80;
const MAX_FIND_MATCHES = 12;
const FIND_CONTEXT_CHARS = 280;

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
      /** Present when the page is longer than one window. */
      total_chars?: number;
      offset?: number;
      next_offset?: number;
      truncated?: boolean;
      sections?: ChatPageSection[];
      note?: string;
    }
  | { error: string };

/** The reader's anchor for a heading (github-slugger, as the renderer uses). */
export const chatHeadingAnchor = (heading: string) => headingSlug(heading);

export type ChatPageSection = { heading: string; anchor: string; level: number; offset: number };

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

/** Headings outside fenced code, with the reader's anchor for each. */
export function chatPageSections(content: string): ChatPageSection[] {
  const sections: ChatPageSection[] = [];
  let fenced = false;
  let offset = 0;
  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      const heading = match[2]!.trim();
      sections.push({ heading, anchor: headingSlug(heading), level: match[1]!.length, offset });
    }
    offset += line.length + 1;
  }
  return sections;
}

function findSection(sections: ChatPageSection[], anchor: string) {
  const wanted = headingSlug(decodeURIComponentSafe(anchor));
  return sections.find((section) => section.anchor === wanted)
    ?? sections.find((section) => section.anchor.startsWith(wanted) || wanted.startsWith(section.anchor));
}

function decodeURIComponentSafe(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** The outline a long page returns: top-level headings first when it is huge. */
function outline(sections: ChatPageSection[]) {
  if (sections.length <= MAX_OUTLINE_SECTIONS) return sections;
  const minLevel = Math.min(...sections.map((section) => section.level));
  const top = sections.filter((section) => section.level <= minLevel + 1);
  return (top.length <= MAX_OUTLINE_SECTIONS ? top : sections.filter((section) => section.level === minLevel))
    .slice(0, MAX_OUTLINE_SECTIONS);
}

async function readablePage(documents: ChatPageDocumentsGateway, slug: string, patterns?: PiiPattern[]) {
  const requested = splitSlugAnchor(slug);
  const publicDoc = await documents.getBySlug({ slug: requested.slug });
  if (!publicDoc) {
    const unavailableDoc = await documents.getBySlug({ slug: requested.slug, includeSensitive: true });
    if (!unavailableDoc) return { requested, error: `Page not found: ${requested.slug}` } as const;
    return { requested, unavailable: redactedReadResult(unavailableDoc, requested.anchor, patterns) } as const;
  }
  return { requested, doc: publicDoc, content: applyPiiRedactions(publicDoc.content, { patterns }) } as const;
}

export async function readChatPageFromDocuments(
  documents: ChatPageDocumentsGateway,
  slug: string,
  options: { patterns?: PiiPattern[]; offset?: number; maxChars?: number } = {},
): Promise<ChatReadPageResult> {
  const page = await readablePage(documents, slug, options.patterns);
  if ("error" in page) return { error: page.error! };
  if ("unavailable" in page) return page.unavailable!;
  const { requested, doc, content } = page;
  const maxChars = options.maxChars ?? CHAT_READ_PAGE_MAX_CHARS;
  const base = {
    slug: doc.slug,
    title: applyPiiRedactions(doc.title, { patterns: options.patterns }),
    href: hrefForSlug(doc.slug, requested.anchor),
    anchor: requested.anchor,
    tags: doc.tags,
  };
  const linked_pages = await resolveLinkedPages(documents, content, doc.slug, options.patterns);
  if (content.length <= maxChars && !options.offset) return { ...base, content, linked_pages };

  // Long page: read one window, starting at the requested section or offset.
  const sections = chatPageSections(content);
  let note: string | undefined;
  let start = Math.max(0, Math.min(options.offset ?? 0, content.length));
  if (options.offset === undefined && requested.anchor) {
    const section = findSection(sections, requested.anchor);
    if (section) start = section.offset;
    else note = `No heading matches #${requested.anchor}; reading from the start.`;
  }
  const end = Math.min(content.length, start + maxChars);
  // Prefer to stop at a line break so a window never ends mid-sentence.
  const lineEnd = end < content.length ? content.lastIndexOf("\n", end) : end;
  const stop = lineEnd > start + maxChars / 2 ? lineEnd : end;
  return {
    ...base,
    content: content.slice(start, stop),
    linked_pages,
    total_chars: content.length,
    offset: start,
    ...(stop < content.length ? { next_offset: stop } : {}),
    truncated: start > 0 || stop < content.length,
    sections: outline(sections),
    ...(note ? { note } : {}),
  } satisfies ChatReadPageResult;
}

export type ChatFindInPageResult =
  | { slug: string; title: string; query: string; total_matches: number; matches: Array<{ offset: number; section?: string; anchor?: string; excerpt: string }> }
  | { error: string }
  | Extract<ChatReadPageResult, { slug: string }>;

/** Every place a page mentions the query (case-insensitive words, all present
 * in a passage), with the nearest heading so the answer can cite the section. */
export async function findInChatPage(
  documents: ChatPageDocumentsGateway,
  slug: string,
  query: string,
  options: { patterns?: PiiPattern[] } = {},
): Promise<ChatFindInPageResult> {
  const page = await readablePage(documents, slug, options.patterns);
  if ("error" in page) return { error: page.error! };
  if ("unavailable" in page) return page.unavailable!;
  const { doc, content } = page;
  const terms = query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter((term) => term.length >= 2);
  if (terms.length === 0) return { error: "Give at least one word to find" };
  const lower = content.toLowerCase();
  const sections = chatPageSections(content);
  const hits: number[] = [];
  // Anchor on the rarest term, then keep passages that contain every term.
  const rarest = [...terms].sort((a, b) => count(lower, a) - count(lower, b))[0]!;
  for (let at = lower.indexOf(rarest); at !== -1; at = lower.indexOf(rarest, at + rarest.length)) {
    const from = Math.max(0, at - FIND_CONTEXT_CHARS);
    const passage = lower.slice(from, at + FIND_CONTEXT_CHARS);
    if (terms.every((term) => passage.includes(term))) {
      if (hits.length && at - hits.at(-1)! < FIND_CONTEXT_CHARS) continue;
      hits.push(at);
    }
  }
  return {
    slug: doc.slug,
    title: applyPiiRedactions(doc.title, { patterns: options.patterns }),
    query,
    total_matches: hits.length,
    matches: hits.slice(0, MAX_FIND_MATCHES).map((at) => {
      const section = [...sections].reverse().find((candidate) => candidate.offset <= at);
      const from = Math.max(0, at - FIND_CONTEXT_CHARS);
      return {
        offset: from,
        ...(section ? { section: section.heading, anchor: section.anchor } : {}),
        excerpt: content.slice(from, Math.min(content.length, at + FIND_CONTEXT_CHARS)).trim(),
      };
    }),
  };
}

function count(haystack: string, needle: string) {
  let total = 0;
  for (let at = haystack.indexOf(needle); at !== -1 && total < 10_000; at = haystack.indexOf(needle, at + needle.length)) total++;
  return total;
}
