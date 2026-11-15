import type { FileNode } from "@oncobase/wiki-content";
import {
  collectHeadings,
  extractMarkdownSection,
  findPassageElement,
  highlightElement,
  markdownOutline,
  scrollToHeading,
  slugifyHeading,
  waitForElement,
  webMcpError,
  type WebMcpTool,
} from "@oncobase/wiki-shell/webmcp";
import type { AssetIndexRow, PageContentRow, PageIndexRow } from "../types";

/**
 * The reader's WebMCP tool set. Every tool reads what the reader itself
 * already shows: LiveStore's manifest copy (no network) or the same
 * same-origin endpoints the UI calls, under the reader's own session.
 *
 * Private pages: even when the reader may open a sensitive page, tool results
 * withhold its body, snippets and comments unless the reader has allowed AI
 * agents to read private pages on this device (see agent-access.ts). An agent
 * may forward tool output to a third-party model; that is a separate consent
 * from being allowed to see the page.
 */

export type ReaderToolDeps = {
  scope: "public" | "session";
  signedIn: boolean;
  pages: () => PageIndexRow[];
  tree: () => FileNode[];
  assets: () => AssetIndexRow[];
  cachedPage: (slug: string) => PageContentRow | null;
  recentSlugs: () => string[];
  allowPrivate: () => boolean;
  commentsEnabled: boolean;
  navigate: (href: string) => void;
  location: () => { pathname: string; search: string; hash: string };
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Rendered markdown root of the current page, if any. */
  contentRoot: () => HTMLElement | null;
  /** True once the page at `slug` has rendered its fresh body. */
  pageReady: (slug: string) => boolean;
};

const MAX_READ_CHARS = 12_000;
const DEFAULT_READ_CHARS = 8_000;
const AI_SEARCH_PER_MINUTE = 6;
const RESTRICTED_ROUTES = /^\/(?:admin|access|pii-view|diagnostics|tools\/(?:dicom|pathology))/;

const hrefFor = (slug: string, anchor?: string) =>
  `${slug === "index" ? "/" : `/${slug.split("/").map(encodeURIComponent).join("/")}`}${anchor ? `#${anchor}` : ""}`;

const parseTags = (raw: string) => {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
};

const str = (value: unknown, max = 500) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const num = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
const normalizeSlug = (value: string) =>
  decodeURIComponent(value.trim()).replace(/^\/+|\/+$/g, "").replace(/\.(?:md|mdx)$/i, "").replace(/#.*$/, "") || "index";
const normalizeFolder = (value: string) => value.trim().replace(/^\/+|\/+$/g, "");

export function slugFromReaderPath(pathname: string) {
  return normalizeSlug(pathname || "/");
}

/** Line → id of the nearest heading at or above it (1-based line numbers). */
export function anchorForLine(markdown: string, lineNumber: number) {
  const lines = markdown.split("\n").slice(0, Math.max(0, lineNumber));
  let inFence = false;
  let anchor: string | undefined;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^#{1,4}\s+(.*?)\s*#*\s*$/.exec(line);
    if (match?.[1]) anchor = slugifyHeading(match[1].replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, ""));
  }
  return anchor;
}

/** Wikilinks and site-relative markdown links in a body, resolved to known slugs. */
export function linkedSlugs(markdown: string, pages: PageIndexRow[]) {
  const bySlug = new Map(pages.map((page) => [page.slug.toLowerCase(), page.slug]));
  const byBase = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const page of pages) {
    const base = page.slug.split("/").at(-1)!.toLowerCase();
    if (!byBase.has(base)) byBase.set(base, page.slug);
    if (page.title && !byTitle.has(page.title.toLowerCase())) byTitle.set(page.title.toLowerCase(), page.slug);
  }
  const resolve = (target: string) => {
    const clean = normalizeSlug(target).toLowerCase();
    return bySlug.get(clean) ?? bySlug.get(`${clean}/index`) ?? byBase.get(clean.split("/").at(-1)!) ?? byTitle.get(clean);
  };
  const found = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const slug = resolve(match[1]!);
    if (slug) found.add(slug);
  }
  for (const match of markdown.matchAll(/\]\((\/?[^)\s:#]+)(?:#[^)]*)?\)/g)) {
    if (/\.(?:png|jpe?g|gif|svg|webp|pdf|csv)$/i.test(match[1]!)) continue;
    const slug = resolve(match[1]!);
    if (slug) found.add(slug);
  }
  return [...found];
}

type TextSearchMatch = { lineNumber?: number; lineContent?: string };
type TextSearchHit = { slug: string; title?: string; tags?: string[]; excerpt?: string; matches?: TextSearchMatch[] };
type AiSearchHit = { slug: string; title?: string; tags?: string[]; relevance?: number; summary?: string; sensitive?: boolean };

export function createReaderTools(deps: ReaderToolDeps): WebMcpTool[] {
  const aiCalls: number[] = [];

  const pageBySlug = (slug: string) => {
    const lower = slug.toLowerCase();
    const pages = deps.pages();
    return pages.find((page) => page.slug === slug)
      ?? pages.find((page) => page.slug.toLowerCase() === lower)
      ?? pages.find((page) => page.slug.toLowerCase() === `${lower}/index`);
  };
  const isPrivate = (page: PageIndexRow | undefined) => Boolean(page?.sensitive);
  const withheld = (page: PageIndexRow | undefined) => isPrivate(page) && !deps.allowPrivate();
  const privateNote = "This is a private page. Its content is withheld from AI agents until the reader allows it (command palette: \"Allow AI agents to read private pages\").";
  const summary = (page: PageIndexRow) => ({
    slug: page.slug,
    title: page.title,
    href: hrefFor(page.slug),
    tags: parseTags(page.tagsJson),
    ...(page.description && !withheld(page) ? { description: page.description } : {}),
    ...(page.sensitive ? { private: true } : {}),
  });

  const readMarkdown = async (page: PageIndexRow, signal?: AbortSignal) => {
    const cached = deps.cachedPage(page.slug);
    if (cached?.contentStatus === "fresh" && cached.content) return cached.content;
    const params = new URLSearchParams({ slug: page.slug });
    if (deps.scope === "public") params.set("scope", "public");
    const response = await deps.fetch(`/api/page-copy?${params}`, { signal, credentials: "same-origin" });
    if (!response.ok) return cached?.content || null;
    return response.text();
  };

  const textSearch = async (query: string, signal?: AbortSignal): Promise<TextSearchHit[]> => {
    const params = new URLSearchParams({ q: query, scope: deps.scope, limit: "200" });
    const request = async (exhaustive: boolean) => {
      const response = await deps.fetch(`/api/search?${params}`, {
        signal,
        credentials: "same-origin",
        ...(exhaustive ? { headers: { "X-Wiki-Search-Wait": "exhaustive" } } : {}),
      });
      const body = (await response.json().catch(() => ({}))) as { results?: TextSearchHit[]; complete?: boolean; error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? `Search failed (${response.status})`);
      return body;
    };
    const first = await request(false);
    if (first.complete === false) {
      // The first answer came from the interim index; ask once for the full one.
      const full = await request(true).catch(() => first);
      return full.results ?? [];
    }
    return first.results ?? [];
  };

  const filterHits = <T extends { slug: string }>(hits: T[], tag: string, folder: string) => hits.filter((hit) => {
    if (folder && hit.slug !== folder && !hit.slug.startsWith(`${folder}/`)) return false;
    if (tag) {
      const page = pageBySlug(hit.slug);
      const tags = page ? parseTags(page.tagsJson) : [];
      if (!tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())) return false;
    }
    return true;
  });

  const currentSlug = () => {
    const { pathname } = deps.location();
    return RESTRICTED_ROUTES.test(pathname) || /^\/(?:search|chat|comments|tags|tools)(?:\/|$)/.test(pathname)
      ? null
      : slugFromReaderPath(pathname);
  };

  const openPage = async (page: PageIndexRow, section: string, signal?: AbortSignal) => {
    const anchor = section ? slugifyHeading(section) : undefined;
    // The previous page stays mounted until the next one renders, so also
    // wait for the rendered body to change, not just the URL.
    const before = currentSlug() !== page.slug ? bodySignature(deps.contentRoot()) : null;
    if (before !== null) deps.navigate(hrefFor(page.slug));
    const ready = await waitForElement(() => {
      if (!deps.pageReady(page.slug)) return null;
      const root = deps.contentRoot();
      return root && (before === null || bodySignature(root) !== before) ? root : null;
    }, { signal, timeoutMs: 8000 });
    if (!ready) return { opened: true, rendered: false, href: hrefFor(page.slug), title: page.title };
    if (!section) {
      ready.closest(".content-shell")?.scrollTo?.({ top: 0 });
      return { opened: true, href: hrefFor(page.slug), title: page.title };
    }
    const outline = collectHeadings(ready);
    const target = outline.find((item) => item.id === anchor || item.id === section)
      ?? outline.find((item) => item.text.toLowerCase() === section.toLowerCase())
      ?? outline.find((item) => item.text.toLowerCase().includes(section.toLowerCase()));
    if (!target) {
      return { opened: true, href: hrefFor(page.slug), title: page.title, section_found: false, sections: outline.map((item) => item.text) };
    }
    scrollToHeading(target.id, ready);
    return { opened: true, href: hrefFor(page.slug, target.id), title: page.title, section: target.text };
  };

  const pageArg = (input: Record<string, unknown>) => {
    const raw = str(input.slug, 400);
    if (!raw) return { error: webMcpError("slug is required. Use search_wiki, browse or get_current_view to find one.") };
    const page = pageBySlug(normalizeSlug(raw));
    if (!page) return { error: webMcpError(`No page "${raw}" in this wiki. Use search_wiki or browse to find the right slug.`) };
    return { page };
  };

  const readOnly = { readOnlyHint: true } as const;

  return [
    {
      name: "search_wiki",
      title: "Search the wiki",
      description:
        "Search every page of this knowledge base. mode \"text\" (default) finds exact words and returns matching lines with deep links to the nearest section; mode \"ai\" ranks pages by meaning and summarizes why each is relevant (slower; use for questions). Filter by tag or folder. Follow up with read_page or open_page.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words or a question. Text mode matches the words literally, so prefer distinctive terms (gene, drug, test name)." },
          mode: { type: "string", enum: ["text", "ai"] },
          tag: { type: "string", description: "Only pages with this tag (see list_tags)." },
          folder: { type: "string", description: "Only pages under this folder slug, e.g. \"treatment\" (see browse)." },
          limit: { type: "number", description: "Max pages to return (default 10, max 30)." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: readOnly,
      execute: async (input, { signal }) => {
        const query = str(input.query, 300);
        if (query.length < 2) return webMcpError("query must be at least 2 characters.");
        const limit = num(input.limit, 10, 1, 30);
        const tag = str(input.tag, 100);
        const folder = normalizeFolder(str(input.folder, 300));
        const text = filterHits(await textSearch(query, signal), tag, folder);
        if (input.mode === "ai") {
          const now = Date.now();
          while (aiCalls.length && now - aiCalls[0]! > 60_000) aiCalls.shift();
          if (aiCalls.length >= AI_SEARCH_PER_MINUTE) return webMcpError("AI search is limited to a few calls a minute. Use mode \"text\" or wait.");
          aiCalls.push(now);
          const response = await deps.fetch(`/api/ai-search?scope=${encodeURIComponent(deps.scope)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ query, slugs: [...new Set(text.map((hit) => hit.slug))].slice(0, 12) }),
            signal,
          });
          const body = (await response.json().catch(() => ({}))) as { results?: AiSearchHit[]; error?: string };
          if (response.status === 402) return webMcpError("AI search quota is exhausted. Use mode \"text\".");
          if (!response.ok || body.error) return webMcpError(body.error ?? `AI search failed (${response.status}).`);
          const results = filterHits(body.results ?? [], tag, folder).slice(0, limit).map((hit) => {
            const page = pageBySlug(hit.slug);
            const hidden = hit.sensitive ? !deps.allowPrivate() : withheld(page);
            return {
              slug: hit.slug,
              title: hit.title ?? page?.title ?? hit.slug,
              href: hrefFor(hit.slug),
              relevance: hit.relevance,
              ...(hidden ? { private: true, summary: privateNote } : { summary: hit.summary }),
            };
          });
          return { mode: "ai", query, results, ...(results.length ? {} : { note: "No relevant pages. Try other words or mode \"text\"." }) };
        }
        const results = text.slice(0, limit).map((hit) => {
          const page = pageBySlug(hit.slug);
          const base = { slug: hit.slug, title: hit.title ?? page?.title ?? hit.slug, href: hrefFor(hit.slug), match_count: hit.matches?.length ?? 1 };
          if (withheld(page)) return { ...base, private: true, note: privateNote };
          const cached = deps.cachedPage(hit.slug);
          const body = cached?.contentStatus === "fresh" ? cached.content : "";
          const matches = (hit.matches ?? []).slice(0, 3).map((match) => {
            const anchor = body && match.lineNumber ? anchorForLine(body, match.lineNumber) : undefined;
            return {
              line: match.lineNumber,
              text: str(match.lineContent, 300),
              ...(anchor ? { section_href: hrefFor(hit.slug, anchor) } : {}),
            };
          });
          return { ...base, ...(matches.length ? { matches } : hit.excerpt ? { excerpt: str(hit.excerpt, 300) } : {}) };
        });
        return {
          mode: "text",
          query,
          total_pages: text.length,
          results,
          ...(results.length ? {} : { note: "No page contains those exact words. Try fewer or different words, or mode \"ai\"." }),
        };
      },
    },
    {
      name: "read_page",
      title: "Read a wiki page",
      description:
        "Read a page's markdown (PII already redacted) with its title, tags, outline, linked pages and source files. Pass section to read just one heading's part of a long page.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Page slug, e.g. \"treatment/chemotherapy\" (\"index\" is the home page)." },
          section: { type: "string", description: "Optional heading text or anchor id to read only that section." },
          max_chars: { type: "number", description: `Truncate the body (default ${DEFAULT_READ_CHARS}, max ${MAX_READ_CHARS}).` },
        },
        required: ["slug"],
        additionalProperties: false,
      },
      annotations: readOnly,
      execute: async (input, { signal }) => {
        const { page, error } = pageArg(input);
        if (error) return error;
        if (withheld(page)) return { ...summary(page!), content: null, note: privateNote };
        const markdown = await readMarkdown(page!, signal);
        if (markdown == null) return webMcpError(`Could not load "${page!.slug}". It may be unavailable offline or restricted.`);
        const section = str(input.section, 200);
        const scoped = section ? extractMarkdownSection(markdown, section) : markdown;
        const outline = markdownOutline(markdown);
        if (section && scoped == null) {
          return { ...summary(page!), section_found: false, outline: outline.map((item) => item.text) };
        }
        const maxChars = num(input.max_chars, DEFAULT_READ_CHARS, 500, MAX_READ_CHARS);
        const body = scoped ?? markdown;
        const pages = deps.pages();
        return {
          ...summary(page!),
          ...(section ? { section } : {}),
          content: body.slice(0, maxChars),
          truncated: body.length > maxChars,
          length: body.length,
          outline: outline.map((item) => ({ ...item, href: hrefFor(page!.slug, item.id) })),
          linked_pages: linkedSlugs(markdown, pages).slice(0, 25).map((slug) => {
            const linked = pageBySlug(slug)!;
            return { slug, title: linked.title };
          }),
          source_files: relatedAssets(page!.slug, deps.assets()).slice(0, 15),
        };
      },
    },
    {
      name: "get_related_pages",
      title: "Find related pages",
      description:
        "Pages that link to this page (backlinks), pages it links to, and pages sharing its tags. Use to explore around a topic.",
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
        additionalProperties: false,
      },
      annotations: readOnly,
      execute: async (input, { signal }) => {
        const { page, error } = pageArg(input);
        if (error) return error;
        const pages = deps.pages();
        const base = page!.slug.split("/").at(-1)!.replace(/^index$/, page!.slug.split("/").at(-2) ?? "index");
        // Backlinks: a literal search for the page's file name, kept only
        // where the matching line links to it.
        const linkPattern = new RegExp(
          `\\[\\[(?:[^\\]|]*/)?${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[#|\\]])|\\]\\(/?(?:[^)]*/)?${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.md)?(?:[#)])`,
          "i",
        );
        const hits = base.length >= 2 ? await textSearch(base, signal).catch(() => []) : [];
        const backlinks = hits
          .filter((hit) => hit.slug !== page!.slug && (hit.matches ?? []).some((match) => linkPattern.test(match.lineContent ?? "")))
          .map((hit) => pageBySlug(hit.slug))
          .filter((candidate): candidate is PageIndexRow => Boolean(candidate))
          .slice(0, 25);
        const markdown = withheld(page) ? null : await readMarkdown(page!, signal).catch(() => null);
        const outlinks = markdown ? linkedSlugs(markdown, pages).map((slug) => pageBySlug(slug)!).slice(0, 25) : [];
        const tags = new Set(parseTags(page!.tagsJson).map((tag) => tag.toLowerCase()));
        const sameTags = tags.size
          ? pages
              .filter((candidate) => candidate.slug !== page!.slug)
              .map((candidate) => ({ candidate, shared: parseTags(candidate.tagsJson).filter((tag) => tags.has(tag.toLowerCase())) }))
              .filter(({ shared }) => shared.length > 0)
              .sort((left, right) => right.shared.length - left.shared.length)
              .slice(0, 15)
              .map(({ candidate, shared }) => ({ slug: candidate.slug, title: candidate.title, shared_tags: shared }))
          : [];
        const brief = (candidate: PageIndexRow) => ({ slug: candidate.slug, title: candidate.title, href: hrefFor(candidate.slug) });
        return {
          slug: page!.slug,
          title: page!.title,
          backlinks: backlinks.map(brief),
          links_to: outlinks.map(brief),
          ...(markdown == null && withheld(page) ? { links_to_note: privateNote } : {}),
          shares_tags: sameTags,
        };
      },
    },
    {
      name: "browse",
      title: "Browse folders",
      description: "List a folder's pages and subfolders, like the sidebar. Omit folder for the top level.",
      inputSchema: {
        type: "object",
        properties: { folder: { type: "string", description: "Folder slug from a previous browse, e.g. \"research\"." } },
        additionalProperties: false,
      },
      annotations: readOnly,
      execute: (input) => {
        const folder = normalizeFolder(str(input.folder, 300));
        const tree = deps.tree();
        let nodes = tree;
        if (folder) {
          const found = findDirectory(tree, folder);
          if (!found) return webMcpError(`No folder "${folder}". Call browse without a folder to see the top level.`);
          nodes = found.children ?? [];
        }
        return {
          folder: folder || "/",
          entries: nodes.map((node) => {
            const page = node.type === "file" ? pageBySlug(node.slug) : undefined;
            return node.type === "directory"
              ? { type: "folder", name: node.name, folder: node.slug, items: countPages(node) }
              : { type: node.type === "pdf" ? "pdf" : "page", name: node.name, slug: node.slug, title: page?.title ?? node.name, ...(page?.sensitive ? { private: true } : {}) };
          }),
        };
      },
    },
    {
      name: "list_tags",
      title: "List tags",
      description: "Every tag in the wiki with how many pages use it.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: readOnly,
      execute: () => {
        const counts = new Map<string, number>();
        for (const page of deps.pages()) for (const tag of parseTags(page.tagsJson)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
        return { tags: [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([tag, pages]) => ({ tag, pages })) };
      },
    },
    {
      name: "get_pages_by_tag",
      title: "Pages with a tag",
      description: "List the pages tagged with a tag.",
      inputSchema: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"], additionalProperties: false },
      annotations: readOnly,
      execute: (input) => {
        const tag = str(input.tag, 100).replace(/^#/, "").toLowerCase();
        const pages = deps.pages().filter((page) => parseTags(page.tagsJson).some((candidate) => candidate.toLowerCase() === tag));
        return pages.length ? { tag, pages: pages.map(summary) } : webMcpError(`No pages are tagged "${tag}". See list_tags.`);
      },
    },
    {
      name: "list_source_files",
      title: "List source files",
      description: "Source PDFs, CSVs and other files in the wiki, optionally only those that belong to one page.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Only files that belong to this page." },
          query: { type: "string", description: "Only files whose path contains this text." },
        },
        additionalProperties: false,
      },
      annotations: readOnly,
      execute: (input) => {
        const slug = str(input.slug, 400);
        const query = str(input.query, 200).toLowerCase();
        let assets = slug ? relatedAssets(normalizeSlug(slug), deps.assets()) : deps.assets().map(assetSummary);
        if (query) assets = assets.filter((asset) => asset.path.toLowerCase().includes(query));
        return { total: assets.length, files: assets.slice(0, 100) };
      },
    },
    {
      name: "recent_pages",
      title: "Recently viewed pages",
      description: "Pages this reader opened recently on this device, most recent first.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: readOnly,
      execute: () => ({
        pages: deps.recentSlugs().map((slug) => pageBySlug(slug)).filter((page): page is PageIndexRow => Boolean(page)).slice(0, 20).map(summary),
      }),
    },
    {
      name: "get_current_view",
      title: "What the reader is looking at",
      description:
        "The page or screen the reader has open: its title, tags, outline, the section in view and any text they selected. Call first to ground answers in what they see.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: readOnly,
      execute: () => {
        const { pathname, search, hash } = deps.location();
        const params = new URLSearchParams(search);
        const restricted = RESTRICTED_ROUTES.test(pathname);
        const base = {
          href: `${pathname}${search}${hash}`,
          title: document.title,
          signed_in: deps.signedIn,
          private_pages_allowed: deps.allowPrivate(),
        };
        if (restricted) return { ...base, screen: screenName(pathname), note: "Agent tools do not read this screen." };
        if (pathname === "/search") return { ...base, screen: "search", query: params.get("q") ?? "", mode: params.get("tab") ?? params.get("mode") ?? "ai" };
        if (pathname.startsWith("/tags/")) {
          const tag = decodeURIComponent(pathname.slice("/tags/".length));
          return { ...base, screen: "tag", tag, pages: deps.pages().filter((page) => parseTags(page.tagsJson).includes(tag)).map(summary) };
        }
        if (pathname.startsWith("/chat")) return { ...base, screen: "chat" };
        if (pathname === "/comments") return { ...base, screen: "comments", note: "Use list_comments to read them." };
        if (pathname.startsWith("/tools/")) return { ...base, screen: screenName(pathname) };
        const slug = slugFromReaderPath(pathname);
        const page = pageBySlug(slug);
        if (!page) return { ...base, screen: "not-found", slug };
        const root = deps.contentRoot();
        const outline = root ? collectHeadings(root) : [];
        const hidden = withheld(page);
        return {
          ...base,
          screen: "page",
          page: summary(page),
          outline: outline.map((item) => ({ ...item, href: hrefFor(page.slug, item.id) })),
          visible_section: visibleHeading(root, outline)?.text,
          ...(hidden ? { note: privateNote } : { selected_text: selectedText(root) }),
        };
      },
    },
    {
      name: "open_page",
      title: "Open a page",
      description: "Show the reader a page, optionally scrolled to a section. Use when they ask to go somewhere, or to show where an answer comes from.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string" },
          section: { type: "string", description: "Heading text or anchor id to scroll to." },
        },
        required: ["slug"],
        additionalProperties: false,
      },
      execute: (input, { signal }) => {
        const { page, error } = pageArg(input);
        if (error) return error;
        return openPage(page!, str(input.section, 200), signal);
      },
    },
    {
      name: "show_passage",
      title: "Highlight a passage",
      description:
        "Scroll to and highlight a sentence on a page so the reader sees exactly where something is stated. Opens the page first if slug is another page. quote must be text copied from the page (a distinctive phrase of 5-20 words works best).",
      inputSchema: {
        type: "object",
        properties: {
          quote: { type: "string" },
          slug: { type: "string", description: "Page containing the quote; defaults to the current page." },
        },
        required: ["quote"],
        additionalProperties: false,
      },
      execute: async (input, { signal }) => {
        const quote = str(input.quote, 600);
        if (quote.length < 3) return webMcpError("quote is required.");
        const requested = str(input.slug, 400);
        const target = requested ? pageBySlug(normalizeSlug(requested)) : pageBySlug(currentSlug() ?? "");
        if (!target) return webMcpError(requested ? `No page "${requested}".` : "The reader is not on a wiki page; pass slug.");
        if (currentSlug() !== target.slug) await openPage(target, "", signal);
        const root = await waitForElement(() => (deps.pageReady(target.slug) ? deps.contentRoot() : null), { signal, timeoutMs: 8000 });
        if (!root) return webMcpError("The page did not finish loading.");
        const element = findPassageElement(root, quote);
        if (!element) return { found: false, slug: target.slug, note: "That text is not on the page. Quote it exactly as read_page returned it." };
        highlightElement(element);
        return { found: true, slug: target.slug, title: target.title, href: hrefFor(target.slug) };
      },
    },
    {
      name: "open_search",
      title: "Show search results",
      description: "Open the search page with a query so the reader sees the full result list.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, mode: { type: "string", enum: ["text", "ai"] } },
        required: ["query"],
        additionalProperties: false,
      },
      execute: (input) => {
        const query = str(input.query, 300);
        if (query.length < 2) return webMcpError("query must be at least 2 characters.");
        const params = new URLSearchParams({ q: query, tab: input.mode === "text" ? "text" : "ai" });
        deps.navigate(`/search?${params}`);
        return { opened: true, href: `/search?${params}` };
      },
    },
    {
      name: "open_tag",
      title: "Show a tag",
      description: "Open the page listing everything with a tag.",
      inputSchema: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"], additionalProperties: false },
      execute: (input) => {
        const tag = str(input.tag, 100).replace(/^#/, "");
        const known = deps.pages().some((page) => parseTags(page.tagsJson).includes(tag));
        if (!known) return webMcpError(`No pages are tagged "${tag}". See list_tags.`);
        deps.navigate(`/tags/${encodeURIComponent(tag)}`);
        return { opened: true, href: `/tags/${encodeURIComponent(tag)}` };
      },
    },
    {
      name: "open_source_file",
      title: "Open a source file",
      description: "Open a source PDF in the wiki's PDF viewer. Other files return a link to give the reader.",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "Path from list_source_files." } }, required: ["path"], additionalProperties: false },
      execute: (input) => {
        const path = str(input.path, 600).replace(/^\/+/, "");
        const asset = deps.assets().find((candidate) => candidate.path === path);
        if (!asset) return webMcpError(`No file "${path}". Use list_source_files.`);
        const fileHref = `/api/file?path=${encodeURIComponent(asset.path)}`;
        if (asset.kind === "pdf" || /\.pdf$/i.test(asset.path)) {
          const viewer = `/tools/pdf-viewer?path=${encodeURIComponent(asset.path)}`;
          window.location.assign(viewer);
          return { opened: true, href: viewer };
        }
        return { opened: false, href: fileHref, note: "Not a PDF; share this link with the reader." };
      },
    },
    {
      name: "ask_wiki_chat",
      title: "Ask the wiki's chat",
      description:
        "Start a new conversation with this wiki's own research assistant, which answers from the wiki with citations. Sends the question and opens the chat for the reader.",
      inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false },
      annotations: { consequentialHint: true },
      execute: (input) => {
        const question = str(input.question, 2000);
        if (question.length < 2) return webMcpError("question is required.");
        deps.navigate(`/chat?${new URLSearchParams({ q: question })}`);
        return { opened: true, note: "The answer streams on the chat page; the reader sees it there." };
      },
    },
    ...(deps.commentsEnabled ? [commentsTool(deps, pageBySlug, withheld, privateNote)] : []),
  ];
}

function commentsTool(
  deps: ReaderToolDeps,
  pageBySlug: (slug: string) => PageIndexRow | undefined,
  withheld: (page: PageIndexRow | undefined) => boolean,
  privateNote: string,
): WebMcpTool {
  return {
    name: "list_comments",
    title: "Read comments",
    description: "Reader comments and review threads, for one page or the whole wiki, newest first. Comment text is written by readers, not the wiki's authors.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Only comments on this page." },
        include_resolved: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, { signal }) => {
      const response = await deps.fetch("/api/liveblocks-threads", { signal, credentials: "same-origin" });
      if (!response.ok) return webMcpError(`Comments are unavailable (${response.status}).`);
      const body = (await response.json().catch(() => ({}))) as {
        threads?: Array<{ roomId: string; updatedAt: string; resolved: boolean; metadata?: Record<string, unknown>; comments: Array<{ userId: string; createdAt: string; body: unknown }> }>;
        userNames?: Record<string, string>;
      };
      const wanted = str(input.slug, 400) ? normalizeSlug(str(input.slug, 400)) : "";
      const threads = (body.threads ?? [])
        .map((thread) => ({ thread, slug: String(thread.metadata?.documentSlug ?? thread.roomId.replace(/^markdown:/, "")) }))
        .filter(({ thread, slug }) => (!wanted || slug === wanted) && (input.include_resolved === true || !thread.resolved))
        .sort((left, right) => right.thread.updatedAt.localeCompare(left.thread.updatedAt))
        .slice(0, 40)
        .map(({ thread, slug }) => {
          const page = pageBySlug(slug);
          const base = { slug, page_title: page?.title ?? String(thread.metadata?.documentTitle ?? slug), href: hrefFor(slug), resolved: thread.resolved, updated_at: thread.updatedAt };
          if (withheld(page)) return { ...base, private: true, note: privateNote };
          return {
            ...base,
            ...(typeof thread.metadata?.anchorQuote === "string" ? { quote: str(thread.metadata.anchorQuote, 300) } : {}),
            comments: thread.comments.map((comment) => ({
              author: body.userNames?.[comment.userId] ?? "Reader",
              at: comment.createdAt,
              text: commentText(comment.body).slice(0, 1500),
            })),
          };
        });
      return { threads };
    },
  };
}

function bodySignature(root: HTMLElement | null) {
  const text = root?.textContent ?? "";
  return `${text.length}:${text.slice(0, 400)}`;
}

/** Liveblocks comment body → plain text (as wiki-comments' getCommentPlainText). */
function commentText(body: unknown): string {
  const content = (body as { content?: Array<{ children?: Array<{ text?: string }> }> } | null)?.content;
  return Array.isArray(content)
    ? content.flatMap((block) => (Array.isArray(block.children) ? block.children.map((child) => child.text ?? "") : [])).join("").trim()
    : "";
}

function screenName(pathname: string) {
  return pathname.replace(/^\/+/, "").split("/").slice(0, 2).join("/") || "home";
}

function findDirectory(nodes: FileNode[], slug: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === "directory" && node.slug.toLowerCase() === slug.toLowerCase()) return node;
    const nested = node.children ? findDirectory(node.children, slug) : null;
    if (nested) return nested;
  }
  return null;
}

function countPages(node: FileNode): number {
  return (node.children ?? []).reduce((total, child) => total + (child.type === "directory" ? countPages(child) : 1), 0);
}

const assetSummary = (asset: AssetIndexRow) => ({ path: asset.path, kind: asset.kind, ...(asset.size ? { bytes: asset.size } : {}) });

function relatedAssets(slug: string, assets: AssetIndexRow[]) {
  const root = slug.replace(/\/index$/i, "");
  return assets
    .filter((asset) => {
      const withoutExtension = asset.path.replace(/\.[^/.]+$/, "");
      return withoutExtension === root || asset.path.startsWith(`${root}/`) || asset.path.startsWith(`${root}.`);
    })
    .map(assetSummary);
}

function visibleHeading(root: HTMLElement | null, outline: Array<{ id: string; text: string }>) {
  if (!root) return undefined;
  let current: { id: string; text: string } | undefined;
  for (const item of outline) {
    const element = root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`);
    if (!element) continue;
    if (element.getBoundingClientRect().top <= window.innerHeight * 0.35) current = item;
    else break;
  }
  return current ?? outline[0];
}

function selectedText(root: HTMLElement | null) {
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || !selection.anchorNode || !root.contains(selection.anchorNode)) return undefined;
  return selection.toString().trim().slice(0, 2000) || undefined;
}
