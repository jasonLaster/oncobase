import { useNavigate } from "react-router";
import type { WikiManifestPage, WikiPageBatch } from "@oncobase/wiki-content";
import {
  educationSearchApiResults,
  normalizeLessonSlug,
  readEducationMarkdown,
  selectedPageText,
  visibleHeading,
} from "@oncobase/education/webmcp";
import {
  findPassageElement,
  highlightElement,
  slugifyHeading,
  useWebMcpTools,
  waitForElement,
  webMcpError,
  type WebMcpTool,
} from "@oncobase/wiki-shell/webmcp";

/** EducationApp passes its own helpers in, so this lazy chunk shares no
 * modules with the reader's startup graph (shared modules would be split into
 * extra eager chunks). */
export type EducationWebMcpHelpers = {
  markdownTitleToText: (title: string) => string;
  isEducationSlug: (slug: string) => boolean;
  educationHref: (slug: string) => string;
  educationSlugFromPathname: (pathname: string) => string | null;
};

/** WebMCP tools for the public /education library. Like the rest of
 * EducationApp they read only the anonymous /api/education endpoints. */

type SearchResponse = {
  results: Array<{ slug: string; title: string; excerpt?: string; matches?: Array<{ lineContent: string }> }>;
  complete?: boolean;
  retryAfterMs?: number;
};

const str = (input: Record<string, unknown>, key: string) =>
  typeof input[key] === "string" ? (input[key] as string).trim() : "";
const article = () => document.querySelector<HTMLElement>('[data-test-id="education-article"]');
const lessonSlug = {
  type: "string",
  description: 'A lesson slug from list_lessons or search_education, such as "wiki/education/oncology-101/index".',
};

async function getJson<T>(url: string, signal?: AbortSignal, headers?: Record<string, string>) {
  const response = await fetch(url, {
    credentials: "omit",
    headers,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`The education library returned ${response.status}.`);
  return (await response.json()) as T;
}

/** Match an agent-supplied slug against the manifest (case, `/index`). */
function resolveSlug(pages: WikiManifestPage[], input: string) {
  const wanted = normalizeLessonSlug(input).toLowerCase();
  return pages.find((page) => {
    const slug = page.slug.toLowerCase();
    return slug === wanted || slug === `${wanted}/index` || (slug.endsWith("/index") && slug.slice(0, -6) === wanted);
  });
}

export function useEducationWebMcpTools(pages: WikiManifestPage[], helpers: EducationWebMcpHelpers) {
  const { markdownTitleToText, isEducationSlug, educationHref, educationSlugFromPathname } = helpers;
  const navigate = useNavigate();
  const currentSlug = () => {
    const slug = educationSlugFromPathname(window.location.pathname);
    return slug ? (resolveSlug(pages, slug)?.slug ?? slug) : null;
  };
  const unknownLesson = () => pages.length ? webMcpError("That lesson is not in the education library. Use a slug from list_lessons or search_education.") : webMcpError("The lesson list is still loading. Try again in a moment.");

  /** Navigate and resolve once the lesson body is rendered. */
  const openLesson = async (slug: string, section: string | undefined, signal?: AbortSignal) => {
    const id = section ? slugifyHeading(section.replace(/^#/, "")) : "";
    if (currentSlug() !== slug || id) void navigate(`${educationHref(slug)}${id ? `#${encodeURIComponent(id)}` : ""}`);
    const ready = await waitForElement(
      () => (currentSlug() === slug && article()?.querySelector(".edu-article-rule") ? true : null),
      { timeoutMs: 10_000, signal },
    );
    if (!ready) return false;
    if (id) {
      const heading = await waitForElement(() => document.getElementById(id), { timeoutMs: 2000, signal });
      heading?.scrollIntoView({ block: "start" });
    }
    return true;
  };

  const tools: WebMcpTool[] = [
    {
      name: "search_education",
      description: "Search the public education library. Returns lessons with slugs for read_page, open_page and show_passage.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The concept to look up (at least two characters)." },
          limit: { type: "number", description: "Maximum results, 1-20 (default 8)." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input, { signal }) => {
        const query = str(input, "query").slice(0, 500);
        if (query.length < 2) return webMcpError("Provide a query of at least two characters.");
        const limit = Number(input.limit) || 8;
        const url = `/api/education/search?q=${encodeURIComponent(query)}&limit=${Math.min(20, Math.max(1, limit))}`;
        let data = await getJson<SearchResponse>(url, signal);
        let partial = data.complete === false;
        if (partial) {
          // The server is still scanning lesson text: wait once for the exhaustive answer.
          await new Promise((resolve) => setTimeout(resolve, Math.max(500, Math.min(data.retryAfterMs ?? 2000, 5000))));
          data = await getJson<SearchResponse>(url, signal, { "X-Wiki-Search-Wait": "exhaustive" });
          partial = data.complete === false;
        }
        const lower = query.toLowerCase();
        const titleMatches = pages
          .filter((page) => `${page.title} ${page.description ?? ""}`.toLowerCase().includes(lower))
          .map((page) => ({ slug: page.slug, title: page.title, excerpt: page.description ?? undefined }));
        const merged = new Map<string, SearchResponse["results"][number]>();
        for (const result of [...titleMatches, ...data.results]) if (isEducationSlug(result.slug)) merged.set(result.slug, result);
        const results = educationSearchApiResults([...merged.values()], educationHref, limit)
          .map((result) => ({ ...result, title: markdownTitleToText(result.title) }));
        return { results, ...(partial ? { partial: true } : {}), ...(results.length ? {} : { note: "Nothing matched. Try broader terms." }) };
      },
    },
    {
      name: "read_page",
      description: "Read a lesson's markdown (up to 6000 characters) and its outline. Pass section (a heading's text or id from the outline) to read just that part.",
      inputSchema: {
        type: "object",
        properties: { slug: lessonSlug, section: { type: "string", description: "Heading text or id from the outline." } },
        required: ["slug"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input, { signal }) => {
        const entry = resolveSlug(pages, str(input, "slug"));
        if (!entry) return unknownLesson();
        const batch = await getJson<WikiPageBatch>(`/api/education/pages?slugs=${encodeURIComponent(entry.slug)}`, signal);
        const page = batch.pages.find((candidate) => candidate.slug === entry.slug && candidate.sensitive === false);
        if (!page) return unknownLesson();
        const result = readEducationMarkdown(
          { slug: page.slug, title: markdownTitleToText(page.title), content: page.content },
          str(input, "section") || undefined,
        );
        return "error" in result ? result : { ...result, href: educationHref(page.slug) };
      },
    },
    {
      name: "list_lessons",
      description: "List every lesson in the public education library with slugs, titles and links.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () =>
        pages.length
          ? { lessons: pages.map((page) => ({ slug: page.slug, title: markdownTitleToText(page.title), href: educationHref(page.slug), description: page.description })) }
          : webMcpError("The lesson list is still loading. Try again in a moment."),
    },
    {
      name: "get_current_view",
      description: "Describe what the reader is looking at: path, page title, the current lesson and its headings, the heading in view and any selected text.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => {
        const slug = currentSlug();
        const entry = slug ? pages.find((page) => page.slug === slug) : undefined;
        const root = article() ?? document.getElementById("education-main");
        const params = new URLSearchParams(window.location.search);
        return {
          path: window.location.pathname,
          title: document.title,
          page: slug ? "lesson" : window.location.pathname === "/education/search" ? "search" : "home",
          ...(params.get("q") ? { query: params.get("q") } : {}),
          lesson: slug
            ? {
                slug,
                title: entry ? markdownTitleToText(entry.title) : null,
                href: educationHref(slug),
                headings: Array.from(root?.querySelectorAll<HTMLElement>("h2[id], h3[id]") ?? []).map((heading) => ({
                  id: heading.id,
                  text: (heading.textContent ?? "").trim(),
                })),
              }
            : null,
          visibleHeading: visibleHeading(root),
          selectedText: selectedPageText(),
        };
      },
    },
    {
      name: "open_page",
      description: "Take the reader to a lesson, optionally scrolled to a section (heading text or id from read_page's outline). Resolves once the lesson is shown.",
      inputSchema: {
        type: "object",
        properties: { slug: lessonSlug, section: { type: "string", description: "Heading text or id to scroll to." } },
        required: ["slug"],
        additionalProperties: false,
      },
      execute: async (input, { signal }) => {
        const entry = resolveSlug(pages, str(input, "slug"));
        if (!entry) return unknownLesson();
        const section = str(input, "section") || undefined;
        if (!(await openLesson(entry.slug, section, signal))) return webMcpError("The lesson did not finish opening.", { href: educationHref(entry.slug) });
        const id = section ? slugifyHeading(section.replace(/^#/, "")) : null;
        return {
          opened: educationHref(entry.slug),
          slug: entry.slug,
          title: markdownTitleToText(entry.title),
          ...(id ? { section: id, sectionFound: Boolean(document.getElementById(id)) } : {}),
        };
      },
    },
    {
      name: "show_passage",
      description: "Scroll to and highlight a quoted passage so the reader sees it. Pass slug to open that lesson first; otherwise the current page is searched, then the library.",
      inputSchema: {
        type: "object",
        properties: { quote: { type: "string", description: "Exact text from the lesson, ideally one sentence." }, slug: lessonSlug },
        required: ["quote"],
        additionalProperties: false,
      },
      execute: async (input, { signal }) => {
        const quote = str(input, "quote");
        if (quote.length < 3) return webMcpError("Provide a longer quote.");
        let slug: string | undefined;
        if (str(input, "slug")) {
          slug = resolveSlug(pages, str(input, "slug"))?.slug;
          if (!slug) return unknownLesson();
        } else if (!(article() && findPassageElement(article()!, quote))) {
          const words = quote.replace(/\s+/g, " ").split(" ").slice(0, 10).join(" ");
          const data = await getJson<SearchResponse>(
            `/api/education/search?q=${encodeURIComponent(words)}&limit=5`,
            signal,
            { "X-Wiki-Search-Wait": "exhaustive" },
          );
          slug = data.results.find((result) => isEducationSlug(result.slug))?.slug;
          if (!slug) return webMcpError("That passage is not on this page or in the library.");
        }
        if (slug && !(await openLesson(slug, undefined, signal))) return webMcpError("The lesson did not finish opening.", { href: educationHref(slug) });
        const element = await waitForElement(
          () => {
            const root = article();
            return root ? findPassageElement(root, quote) : null;
          },
          { timeoutMs: 4000, signal },
        );
        if (!element) return webMcpError("That passage was not found on the page.", { path: window.location.pathname });
        highlightElement(element);
        return { shown: true, path: window.location.pathname, text: (element.textContent ?? "").trim().slice(0, 500) };
      },
    },
  ];

  useWebMcpTools(tools, { key: "education" });
}

/** Mount point for EducationApp's lazy import. */
export function EducationWebMcp({ pages, helpers }: { pages: WikiManifestPage[]; helpers: EducationWebMcpHelpers }) {
  useEducationWebMcpTools(pages, helpers);
  return null;
}
