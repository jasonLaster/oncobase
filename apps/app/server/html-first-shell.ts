import { WIKI_READER_CACHE_VERSION, compactFileTree, type FileNode } from "@oncobase/wiki-content";
import { bootHtmlFirstPage } from "./html-first-boot";
import { MAX_BOOTSTRAP_BYTES, serializePageBootstrap } from "../src/bootstrap/page-payload";

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

export function injectHtmlFirstShell(html: string, page: PublicPage, url: URL, siteSlug: string, criticalCss: string, body: string, navigationTree = "", tree?: FileNode[]) {
  // A stable revision is required for handing over to the same live article.
  if (page.sensitive !== false || !page.contentHash || !html.includes('<div id="root">')) return html;
  if (criticalCss) {
    html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, tag =>
      tag.replace('rel="stylesheet"', 'data-wiki-inlined-style').replace('href="', 'data-wiki-style-source="'));
    html = html.replace(/<script\b[^>]*type="module"[^>]*src="[^\"]+"[^>]*><\/script>/g,
      tag => tag.replace('type="module"', 'type="application/x-wiki-module"').replace('src="', 'data-wiki-module-src="'));
    html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g,
      tag => tag.replace('rel="modulepreload"', 'data-wiki-module-preload'));
    html = html.replace("</head>", () => `<style id="wiki-critical-style">${criticalCss}</style></head>`);
  }
  const largeArticle = Buffer.byteLength(page.content) > 131_072;
  const payload = !largeArticle ? serializePageBootstrap({
    version: 1, readerVersion: WIKI_READER_CACHE_VERSION,
    origin: url.origin, pathname: url.pathname, siteSlug, scope: "public",
    page: { slug: page.slug, title: page.title, content: page.content,
      contentHash: page.contentHash, tags: page.tags ?? [], sensitive: false,
      size: Buffer.byteLength(page.content) },
  }) : "";
  // Large articles remain complete HTML. Let the app fetch their Markdown
  // after first paint instead of duplicating hundreds of KiB in the document.
  const bootstrap = payload && Buffer.byteLength(payload) <= Math.min(MAX_BOOTSTRAP_BYTES, 131_072)
    ? `<script id="wiki-page-bootstrap" type="application/json">${payload}</script>` : "";
  const navigationPayload = tree ? `<script id="wiki-navigation-bootstrap" type="application/json">${JSON.stringify({
    version: 1, readerVersion: WIKI_READER_CACHE_VERSION, origin: url.origin,
    pathname: url.pathname, siteSlug, scope: "public", tree: compactFileTree(tree),
  }).replace(/[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)}</script>` : "";
  const interactive = new URL(url);
  interactive.searchParams.set("html-first", "off");
  const fallbackHref = escape(interactive.pathname + interactive.search + interactive.hash);
  const header = page.slug === "index" ? "" : `<header class="wiki-shell-page-header"><h1>${escape(page.title)}</h1></header>`;
  const navigation = `<a href="/">Home</a><a href="/search">Search</a><a href="${fallbackHref}">Open interactive reader</a>`;
  const shell = `<div id="wiki-html-first" class="prototype-shell"${largeArticle ? ' data-large-article="true"' : ""} data-slug="${escape(page.slug)}" data-hash="${escape(page.contentHash)}">
    <div class="app-shell wiki-shell-resizable-layout">
      <nav class="html-first-navigation" aria-label="Site navigation">${navigation}<details class="html-first-files" open><summary>Files</summary><div class="html-first-tree" aria-label="Files">${navigationTree}</div></details></nav>
      <div class="app-content"><main class="content-shell"><div class="wiki-shell-outline-root" style="--comments-pane-width:64px"><div class="wiki-shell-outline-content"><div class="wiki-shell-outline-content-inner">
        <article class="wiki-shell-document-article page-shell" aria-label="${escape(page.title)}">${header}<div class="wiki-markdown prose max-w-none">${body}</div></article>
      </div></div></div></main></div>
    </div>
  </div>`;
  // Position the app underneath the early page without adding a second viewport
  // to document flow. Its own geometry remains measurable during startup.
  const css = `<style id="wiki-html-first-style">
    #root{position:fixed;inset:0;visibility:hidden}
    #wiki-html-first[data-large-article] .wiki-markdown > :nth-child(n+4){content-visibility:auto;contain-intrinsic-size:auto 64px}
    #wiki-html-first .app-content{margin-left:var(--html-sidebar-width,259px)}
    #wiki-html-first .html-first-navigation{position:absolute;inset:0 auto 0 0;width:var(--html-sidebar-width,259px);background:var(--sidebar-bg);border-right:1px solid var(--sidebar-border);padding:20px 16px;display:flex;flex-direction:column;gap:16px;overflow:auto;font-size:14px}
    #wiki-html-first .html-first-navigation a{color:var(--text-muted);text-decoration:none}
    #wiki-html-first .html-first-tree{display:flex;flex-direction:column;gap:4px}
    #wiki-html-first .html-first-tree a,#wiki-html-first summary{display:block;padding:4px 0;cursor:pointer;overflow-wrap:anywhere}
    #wiki-html-first summary{display:list-item;list-style-position:inside}
    #wiki-html-first .html-first-tree-children{padding-left:14px}
    #wiki-html-first [aria-current="page"]{font-weight:600;color:var(--text-primary)}
    @media(min-width:768px){#wiki-html-first .html-first-files>summary{display:none}}
    @media(max-width:767px){#wiki-html-first .html-first-files[open] .html-first-tree{position:absolute;top:48px;left:0;right:0;max-height:60vh;overflow:auto;padding:16px;background:var(--sidebar-bg);border-bottom:1px solid var(--sidebar-border)}}
    @media(max-width:767px){#wiki-html-first .app-content{margin-left:0}#wiki-html-first .html-first-navigation{position:absolute;inset:0 0 auto;width:auto;height:48px;padding:12px 18px;flex-direction:row;z-index:1;white-space:nowrap;overflow:visible}}
  </style>`;
  // Replacement strings interpret $&, $`, and $'. They can occur in article
  // text and in minified JavaScript (for example a variable named $ && ...).
  return html.replace("</head>", () => css + "</head>")
    .replace('<div id="root">', () => shell + '<div id="root">')
    .replace("</body>", () => `${bootstrap}${navigationPayload}<script>(${bootHtmlFirstPage.toString()})()</script></body>`);
}
