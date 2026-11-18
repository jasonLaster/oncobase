import { extractMarkdownSection, headingText, markdownOutline, webMcpError } from "@oncobase/wiki-shell/webmcp";
import { searchEducation, type EducationCorpus, type EducationSection } from "./chat";
import { lessonAtPath, normalizeEducationPath } from "./talk";

/** Pure handlers behind the education WebMCP tools (OncoGuide and the
 * /education app). The page components own fetching, navigation and DOM. */

export const EDUCATION_SLUG_PREFIX = "wiki/education/";
export const MAX_SECTION_CHARS = 6000;
export const MAX_SEARCH_RESULTS = 20;

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}…` : text;
const snippet = (text: string) => clip(text.replace(/\s+/g, " ").trim(), 280);

/** Accept "dna", "wiki/education/dna", "/education/dna/", a full URL or a
 * section href and return the canonical "wiki/education/…" slug. */
export function normalizeLessonSlug(input: string): string {
  let value = input.trim();
  try { if (/^https?:\/\//i.test(value)) value = new URL(value).pathname; } catch { /* keep as is */ }
  value = value.split(/[?#]/)[0]!;
  try { value = decodeURIComponent(value); } catch { /* keep as is */ }
  value = value.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.(?:md|mdx)$/i, "");
  value = value.replace(/^wiki\/education(?:\/|$)/, "").replace(/^education(?:\/|$)/, "");
  return `${EDUCATION_SLUG_PREFIX}${value}`.replace(/\/$/, "");
}

/** Sections of a lesson; tolerates the `/index` suffix being present or not. */
function sectionsForSlug(corpus: EducationCorpus, slug: string) {
  const wanted = normalizeLessonSlug(slug);
  const exact = corpus.sections.filter(section => section.slug === wanted);
  if (exact.length) return exact;
  const alternate = wanted.endsWith("/index") ? wanted.slice(0, -"/index".length) : `${wanted}/index`;
  return corpus.sections.filter(section => section.slug === alternate);
}

const sectionSummary = (section: EducationSection) => ({
  id: section.id, slug: section.slug, href: section.href, pageTitle: section.pageTitle, heading: section.heading,
});

export function searchEducationSections(corpus: EducationCorpus, query: string, limit = 8) {
  const text = query.trim().slice(0, 500);
  if (!text) return webMcpError("Provide a query.");
  const count = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(Number(limit) || 8)));
  const results = searchEducation(corpus.sections, text, count).map(section => ({ ...sectionSummary(section), snippet: snippet(section.text) }));
  return results.length ? { results } : { results, note: "Nothing in the library matched. Try other terms." };
}

export function readEducationSection(corpus: EducationCorpus, sectionId: string) {
  const section = corpus.sections.find(candidate => candidate.id === sectionId);
  if (!section) return webMcpError("That section is not in the library. Use an id from search_education or lesson_sections.");
  return {
    ...sectionSummary(section),
    text: clip(section.text, MAX_SECTION_CHARS),
    truncated: section.text.length > MAX_SECTION_CHARS,
    illustrations: section.images.map(image => image.alt).filter(Boolean),
  };
}

export function educationLessonSections(corpus: EducationCorpus, slug: string) {
  const sections = sectionsForSlug(corpus, slug);
  if (!sections.length) return webMcpError("That lesson is not in the library. Use a slug from list_lessons or search_education.");
  return {
    slug: sections[0]!.slug, title: sections[0]!.pageTitle, href: lessonHref(sections[0]!),
    sections: sections.map(({ id, heading, href }) => ({ id, heading, href })),
  };
}

const lessonHref = (section: EducationSection) => section.href.split("#")[0]!;

/** Every lesson in the corpus, in corpus order. */
export function educationLessonsFromCorpus(corpus: EducationCorpus) {
  const lessons = new Map<string, { slug: string; title: string; href: string }>();
  for (const section of corpus.sections)
    if (!lessons.has(section.slug)) lessons.set(section.slug, { slug: section.slug, title: section.pageTitle, href: lessonHref(section) });
  return [...lessons.values()];
}

/** The section (or lesson start) a navigation tool should open. */
export function resolveEducationTarget(corpus: EducationCorpus, input: { section_id?: unknown; slug?: unknown }):
  { section: EducationSection } | { error: string } {
  if (typeof input.section_id === "string" && input.section_id) {
    const section = corpus.sections.find(candidate => candidate.id === input.section_id);
    return section ? { section } : webMcpError("That section is not in the library. Use an id from search_education or lesson_sections.");
  }
  if (typeof input.slug === "string" && input.slug) {
    const section = sectionsForSlug(corpus, input.slug)[0];
    return section ? { section: { ...section, href: lessonHref(section) } } : webMcpError("That lesson is not in the library. Use a slug from list_lessons.");
  }
  return webMcpError("Provide a section_id or a slug.");
}

/** The lesson a reader path shows, with its sections, or null. */
export function educationLessonAtPath(corpus: EducationCorpus, path: string) {
  const first = lessonAtPath(corpus, path);
  if (!first) return null;
  return {
    slug: first.slug, title: first.pageTitle, href: normalizeEducationPath(first.href),
    sections: corpus.sections.filter(section => section.slug === first.slug).map(({ id, heading, href }) => ({ id, heading, href })),
  };
}

/** read_page for the /education app: a markdown body, optionally narrowed to
 * one heading (by text or anchor id), with its outline. */
export function readEducationMarkdown(page: { slug: string; title: string; content: string }, section?: string) {
  const outline = markdownOutline(page.content);
  let text = page.content;
  if (section) {
    const extracted = extractMarkdownSection(page.content, section.replace(/^#/, ""));
    if (!extracted) return webMcpError(`No heading "${section}" in this lesson.`, { outline: outline.map(({ id, text: heading }) => ({ id, heading })) });
    text = extracted;
  }
  return {
    slug: page.slug, title: page.title,
    ...(section ? { section } : {}),
    text: clip(text, MAX_SECTION_CHARS),
    truncated: text.length > MAX_SECTION_CHARS,
    outline: outline.map(({ id, text: heading, level }) => ({ id, heading, level })),
  };
}

/** Normalise /api/education/search results for search_education. */
export function educationSearchApiResults(
  results: Array<{ slug: string; title: string; excerpt?: string; matches?: Array<{ lineContent: string }> }>,
  hrefFor: (slug: string) => string,
  limit = 8,
) {
  const count = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(Number(limit) || 8)));
  return results.filter(result => result.slug.startsWith(EDUCATION_SLUG_PREFIX)).slice(0, count).map(result => ({
    slug: result.slug, title: result.title, href: hrefFor(result.slug),
    snippet: snippet(result.excerpt || result.matches?.[0]?.lineContent || ""),
  }));
}

// ---------------------------------------------------------------------------
// DOM helpers shared by both readers' get_current_view.

export function selectedPageText(max = 2000) {
  if (typeof window === "undefined") return "";
  return clip(window.getSelection()?.toString().trim() ?? "", max);
}

/** The last heading whose top has scrolled past the upper third of the viewport. */
export function visibleHeading(root: ParentNode | null) {
  if (!root || typeof window === "undefined") return null;
  const headings = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
  const line = window.innerHeight / 3;
  let current: HTMLElement | null = null;
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= line) current = heading;
    else break;
  }
  current ??= headings[0] ?? null;
  return current ? { id: current.id || null, text: headingText(current) } : null;
}
