import { prepareHtmlFirstPresentation } from "./html-first-presentation";
import { renderReaderPageHeader } from "./reader-page-header";
import { renderReaderSidebar } from "./reader-sidebar";
import { createCommandPaletteChords } from "@oncobase/wiki-shell";
import { installReaderShortcuts } from "../src/bootstrap/reader-shortcuts";
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
  const header = renderReaderPageHeader(page);
  const navigation = renderReaderSidebar(navigationTree, url);
  const shell = `<div id="wiki-html-first" class="prototype-shell"${largeArticle ? ' data-large-article="true"' : ""} data-slug="${escape(page.slug)}" data-hash="${escape(page.contentHash)}">
    <div class="app-shell wiki-shell-resizable-layout">
      <div class="html-first-sidebar-rail sidebar-expanded-rail">${navigation}</div>
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
    #wiki-html-first .html-first-sidebar-rail{position:absolute;inset:0 auto 0 0;width:var(--html-sidebar-width,259px);border-right:3px solid var(--sidebar-border)}
    #wiki-html-first .html-first-navigation{width:100%}
    #wiki-html-first .wiki-vite-sidebar-workspace{flex:0 1 auto;max-width:calc(100% - 2.5rem)}
    #wiki-html-first .html-first-files{display:block;flex:1;min-height:0;overflow:auto}
    #wiki-html-first .html-first-files>nav{width:100%;height:100%}
    #wiki-html-first .html-first-tree>*{margin-top:4px}
    #wiki-html-first .html-first-tree-children{padding-top:2px}
    #wiki-html-first summary.wiki-shell-tree-directory{list-style:none;cursor:pointer}
    #wiki-html-first summary::-webkit-details-marker{display:none}
    #wiki-html-first .html-first-search{font-size:16px}
    #wiki-html-first .html-first-sign-in{align-items:center;display:flex;justify-content:center;gap:8px;background:var(--reader-sign-in-bg);border:1px solid var(--reader-sign-in-bg);border-radius:8px;color:white;margin-top:8px;min-height:42px;padding:8px 10px;text-decoration:none}
    #wiki-html-first .html-first-mobile-title,#wiki-html-first .html-first-mobile-action{display:none}
    @media(min-width:768px){#wiki-html-first .html-first-files>summary{display:none}}
    @media(max-width:767px){
      #wiki-html-first .app-content{margin-left:0}
      #wiki-html-first .html-first-sidebar-rail{display:block;inset:0 0 auto;width:auto;height:48px;border:0;z-index:40}
      #wiki-html-first .html-first-navigation{display:flex;flex-direction:row;align-items:center;gap:8px;padding:0 12px;overflow:visible;border-bottom:1px solid var(--sidebar-border)}
      #wiki-html-first .wiki-shell-sidebar-heading,#wiki-html-first .wiki-shell-sidebar-footer{display:none}
      #wiki-html-first .html-first-mobile-title{display:block}
      #wiki-html-first .html-first-mobile-action,#wiki-html-first .html-first-files>summary{display:inline-flex;align-items:center;justify-content:center;flex:0 0 36px;width:36px;height:36px;border:1px solid var(--sidebar-border);border-radius:8px;background:var(--background);color:var(--text-muted);cursor:pointer;list-style:none}
      #wiki-html-first .html-first-files>summary::-webkit-details-marker{display:none}
      #wiki-html-first .html-first-files{display:block;flex:0 0 36px;overflow:visible;margin:0;padding:0}
      #wiki-html-first .html-first-files:not([open])>nav{display:none}
      #wiki-html-first .html-first-files[open]~.wiki-vite-mobile-ask{display:none}
      #wiki-html-first .html-first-files[open]>nav{position:absolute;top:48px;left:0;width:100%;height:auto;max-height:60vh;background:var(--sidebar-bg);border-bottom:1px solid var(--sidebar-border)}
    }
  </style>`;
  // Replacement strings interpret $&, $`, and $'. They can occur in article
  // text and in minified JavaScript (for example a variable named $ && ...).
  const shortcuts = `<script>(${prepareHtmlFirstPresentation.toString()})()</script><script>(${installReaderShortcuts.toString()})(${createCommandPaletteChords.toString()})</script>`;
  return html.replace("</head>", () => css + shortcuts + "</head>")
    .replace('<div id="root">', () => shell + '<div id="root">')
    .replace("</body>", () => `${bootstrap}${navigationPayload}<script>(${bootHtmlFirstPage.toString()})()</script></body>`);
}
