import { WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { renderWikiMarkdownHtml } from "@oncobase/wiki-markdown/server";
import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { bootHtmlFirstPage } from "./html-first-boot";
import { MAX_BOOTSTRAP_BYTES, serializePageBootstrap } from "../src/bootstrap/page-payload";
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

function renderBody(page: RenderablePage) {
  // Sanitize AFTER every markdown transformation, including PDF filenames.
  // The experiment supports ordinary reading; richer SVG/math widgets arrive
  // with the app. Do not expose pretend image buttons before their handlers.
  const tree = sanitize(fromHtml(renderWikiMarkdownHtml(page.content, page.slug), { fragment: true }), {
    ...defaultSchema,
    clobberPrefix: "wiki-html-",
    attributes: {
      ...defaultSchema.attributes,
      "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    },
  });
  const body = toHtml(tree)
    .replace(/<img\b[^>]*>/g, tag => tag.replace(/\s(?:tabindex|aria-label)="[^"]*"/g, ""))
    .replace(/href="#([^\"]*)"/g, 'href="#wiki-html-$1"');
  return body;
}

const cachedBody = createHtmlPageCache(renderBody);
export function renderHtmlFirstBody(page: PublicPage, siteSlug: string) {
  return cachedBody(siteSlug, page);
}

export function injectHtmlFirstPage(html: string, page: PublicPage, url: URL, siteSlug: string, criticalCss = "") {
  // A stable revision is required for handing over to the same live article.
  if (page.sensitive !== false || !page.contentHash || !html.includes('<div id="root">')) return html;
  const body = renderHtmlFirstBody(page, siteSlug);
  if (criticalCss) {
    html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, tag =>
      tag.replace(/\s*\/?>$/, ' data-wiki-full-style media="print" onload="this.media=\'all\';window.dispatchEvent(new Event(\'wiki-full-style-ready\'))">'));
    html = html.replace("</head>", `<style id="wiki-critical-style">${criticalCss}</style></head>`);
  }
  const payload = serializePageBootstrap({
    version: 1, readerVersion: WIKI_READER_CACHE_VERSION,
    origin: url.origin, pathname: url.pathname, siteSlug, scope: "public",
    page: { slug: page.slug, title: page.title, content: page.content,
      contentHash: page.contentHash, tags: page.tags ?? [], sensitive: false,
      size: Buffer.byteLength(page.content) },
  });
  const bootstrap = Buffer.byteLength(payload) <= MAX_BOOTSTRAP_BYTES
    ? `<script id="wiki-page-bootstrap" type="application/json">${payload}</script>` : "";
  const interactive = new URL(url);
  interactive.searchParams.set("html-first", "off");
  const fallbackHref = escape(interactive.pathname + interactive.search + interactive.hash);
  const header = page.slug === "index" ? "" : `<header class="wiki-shell-page-header"><h1>${escape(page.title)}</h1></header>`;
  const navigation = `<a href="/">Home</a><a href="/search">Search</a><a href="${fallbackHref}">Open interactive reader</a>`;
  const shell = `<div id="wiki-html-first" class="prototype-shell" data-slug="${escape(page.slug)}" data-hash="${escape(page.contentHash)}">
    <div class="app-shell wiki-shell-resizable-layout">
      <nav class="html-first-navigation" aria-label="Site navigation">${navigation}</nav>
      <div class="app-content"><main class="content-shell"><div class="wiki-shell-outline-root" style="--comments-pane-width:64px"><div class="wiki-shell-outline-content"><div class="wiki-shell-outline-content-inner">
        <article class="wiki-shell-document-article page-shell" aria-label="${escape(page.title)}">${header}<div class="wiki-markdown prose max-w-none">${body}</div></article>
      </div></div></div></main></div>
    </div>
  </div>`;
  // Position the app underneath the early page without adding a second viewport
  // to document flow. Its own geometry remains measurable during startup.
  const css = `<style id="wiki-html-first-style">
    #root{position:fixed;inset:0;visibility:hidden}
    #wiki-html-first .html-first-navigation{flex:0 0 var(--html-sidebar-width,259px);background:var(--sidebar-bg);border-right:1px solid var(--sidebar-border);padding:20px 16px;display:flex;flex-direction:column;gap:16px;overflow:hidden;font-size:14px}
    #wiki-html-first .html-first-navigation a{color:var(--text-muted)}
    @media(max-width:767px){#wiki-html-first .html-first-navigation{position:absolute;inset:0 0 auto;height:48px;padding:12px 18px;flex-direction:row;z-index:1;white-space:nowrap}}
  </style>`;
  return html.replace("</head>", css + "</head>")
    .replace('<div id="root">', shell + '<div id="root">')
    .replace("</body>", `${bootstrap}<script>(${bootHtmlFirstPage.toString()})()</script></body>`);
}
