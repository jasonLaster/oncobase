import { injectHtmlFirstShell } from "./html-first-shell";
import { formatWikiHtml } from "@oncobase/wiki-markdown/server-format";
import { resolveWikilinks } from "@oncobase/wiki-markdown/paths";
import { preprocessCitationMarkdown } from "@oncobase/wiki-markdown/citations";
import { Marked } from "marked";
import GithubSlugger from "github-slugger";
import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { toString } from "hast-util-to-string";
import { createHtmlPageCache, type RenderablePage } from "./html-page-cache";

type PublicPage = {
  slug: string;
  title: string;
  content: string;
  contentHash?: string | null;
  sensitive?: boolean;
  tags?: string[];
};

function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markdownRenderer() {
  const slugger = new GithubSlugger();
  const markdown = new Marked({ async: false, gfm: true, renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      // Slug the decoded text nodes, exactly as rehype-slug does. Slugging
      // serialized HTML gives &amp; a different ID and strips code underscores.
      const headingText = toString(fromHtml(text, { fragment: true }));
      const id = escape(slugger.slug(headingText));
      return `<h${depth} class="wiki-heading-group" id="${id}">${text}<a class="heading-anchor" href="#${id}" aria-label="${escape(`Link to "${headingText}"`)}">#</a></h${depth}>\n`;
    },
    code({ text, lang }) {
      if (lang === "mermaid") return '<p class="text-muted">Diagram loads with the interactive reader.</p>';
      return `<pre><code>${escape(text)}</code></pre>`;
    },
  } });
  return markdown;
}

function sanitizeBody(html: string, slug: string) {
  const rendered = formatWikiHtml(html, slug);
  // Sanitize AFTER every markdown transformation, including PDF filenames.
  // The experiment supports ordinary reading; richer SVG/math widgets arrive
  // with the app. Do not expose pretend image buttons before their handlers.
  const tree = sanitize(fromHtml(rendered, { fragment: true }), {
    ...defaultSchema,
    clobberPrefix: "wiki-html-",
    attributes: {
      ...defaultSchema.attributes,
      "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
      // These tags have narrower default class allowlists than the wildcard.
      // Retain the generated heading/permalink classes after sanitization.
      ...Object.fromEntries(["a", "h1", "h2", "h3", "h4", "h5", "h6"].map(tag => [tag, [
        ...(defaultSchema.attributes?.[tag] ?? []).filter(attribute => !(Array.isArray(attribute) && attribute[0] === "className")),
        "className",
      ]])),
    },
  });
  const body = toHtml(tree)
    .replace(/<img\b[^>]*>/g, tag => tag.replace(/\s(?:tabindex|aria-label|loading|decoding)="[^"]*"/g, "").replace("<img", '<img loading="lazy" decoding="async"'))
    .replace(/href="#([^\"]*)"/g, 'href="#wiki-html-$1"');
  return body;
}

function renderBody(page: RenderablePage) {
  const source = preprocessCitationMarkdown(resolveWikilinks(page.content, page.slug));
  return sanitizeBody(markdownRenderer().parse(source, { async: false }), page.slug);
}

/** Complete markdown blocks let the beginning arrive while the rest renders. */
export function renderHtmlFirstParts(page: RenderablePage) {
  const markdown = markdownRenderer();
  const source = preprocessCitationMarkdown(resolveWikilinks(page.content, page.slug));
  const tokens = markdown.lexer(source, markdown.defaults);
  // Raw HTML can span markdown blocks. Preserve its complete parse context.
  if (tokens.some(token => token.type === "html")) {
    const body = renderBody(page);
    if (Buffer.byteLength(page.content) <= 131_072) return { first: body, rest: () => "" };
    // Parse the complete sanitized document first, then split only its complete
    // top-level nodes. Raw HTML may cross Markdown token boundaries.
    const tree = fromHtml(body, { fragment: true });
    let end = 0, first = "";
    while (end < tree.children.length && first.length < 3000) first += toHtml(tree.children[end++]!);
    let remainder: string | undefined;
    return { first, rest: () => remainder ??= toHtml({ type: "root", children: tree.children.slice(end) }) };
  }
  let end = 0, size = 0;
  while (end < tokens.length && size < 3000) {
    if (size > 0 && tokens[end]!.raw.length > 4000) break;
    size += tokens[end++]!.raw.length;
  }
  const render = (part: typeof tokens) => sanitizeBody(markdown.parser(part, markdown.defaults), page.slug);
  const first = render(Object.assign(tokens.slice(0, end), { links: tokens.links }));
  let remainder: string | undefined;
  return { first, rest: () => remainder ??= render(Object.assign(tokens.slice(end), { links: tokens.links })) };
}

/** Keep long remainders inert until the opening text paints. With scripting
 * disabled, noscript content is ordinary, complete article markup. */
export function renderReadableHtmlFirstParts(page: RenderablePage) {
  const parts = renderHtmlFirstParts(page);
  if (Buffer.byteLength(page.content) <= 131_072) return parts;
  return { first: parts.first, rest: () => {
    const rest = parts.rest();
    // The source has already passed the final sanitizer. Preserve full context
    // rather than wrapping if an unsupported raw-text boundary ever appears.
    return rest && !/<\/noscript\b/i.test(rest) ? `<noscript id="wiki-html-first-rest">${rest}</noscript>` : rest;
  } };
}

export function renderHtmlFirstReadingBody(page: PublicPage, siteSlug: string) {
  if (Buffer.byteLength(page.content) <= 131_072) return renderHtmlFirstBody(page, siteSlug);
  const parts = renderReadableHtmlFirstParts(page);
  return parts.first + parts.rest();
}

const cachedBody = createHtmlPageCache(renderBody);
export function renderHtmlFirstBody(page: PublicPage, siteSlug: string) {
  return cachedBody(siteSlug, page);
}

export function injectHtmlFirstPage(html: string, page: PublicPage, url: URL, siteSlug: string, criticalCss = "", navigationTree = "", tree?: import("@oncobase/wiki-content").FileNode[]) {
  if (page.sensitive !== false || !page.contentHash) return html;
  return injectHtmlFirstShell(html, page, url, siteSlug, criticalCss, renderHtmlFirstReadingBody(page, siteSlug), navigationTree, tree);
}
