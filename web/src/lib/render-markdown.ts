import fs from "fs";
import path from "path";
import crypto from "crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
} from "@/lib/markdown-math";

const processor = unified()
  .use(remarkParse)
  .use(markdownRemarkPlugins)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(markdownRehypePlugins)
  .use(rehypeSlug)
  .use(rehypeStringify);

// Bump this when the remark/rehype pipeline changes to invalidate cached HTML
const PIPELINE_VERSION = "20";

// ─── Mermaid pre-processor ────────────────────────────────────────────────────
//
// Renders ```mermaid fenced code blocks to SVG server-side using beautiful-mermaid.
// Both light and dark SVGs are rendered; CSS toggles which is visible based on
// the .dark class applied by the theme switcher.
//
// Output:
//   <div class="mermaid-diagram dark:hidden"><!-- github-light svg --></div>
//   <div class="mermaid-diagram hidden dark:block"><!-- github-dark svg --></div>

function extractMermaidBlocks(md: string): string {
  return md.replace(/^```mermaid\r?\n([\s\S]*?)^```/gm, (_match, graph: string) => {
    const src = graph.trimEnd();
    try {
      const svgLight = renderMermaidSVG(src, THEMES["github-light"]);
      const svgDark = renderMermaidSVG(src, THEMES["github-dark"]);
      return (
        `<div class="mermaid-diagram dark:hidden">${svgLight}</div>` +
        `<div class="mermaid-diagram hidden dark:block">${svgDark}</div>`
      );
    } catch (err) {
      console.warn("Mermaid render error:", err);
      // Fallback to client-side rendering for diagrams unsupported by beautiful-mermaid
      // (for example, timeline/gantt).
      const encoded = Buffer.from(src, "utf-8").toString("base64");
      return `<div class="mermaid-placeholder" data-graph="${encoded}"></div>`;
    }
  });
}

// ─── Legacy table directive cleanup ──────────────────────────────────────────
//
// Older markdown pages used `<!-- table-cols: ... -->` comments to steer a
// post-processing `<colgroup>` injection pass. Tables now size themselves on
// the client, but we still strip the legacy comments so they never leak into
// the rendered HTML or search snippets.

function stripLegacyTableDirectives(md: string): string {
  return md.replace(/^\s*<!--\s*table-cols:\s*.*?-->\s*$/gm, "");
}

type TagDecoration = {
  className?: string;
  attributes?: Record<string, string>;
};

function decorateOpeningTag(
  html: string,
  tagName: string,
  decoration: TagDecoration
): string {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, "g");

  return html.replace(pattern, (_match, rawAttributes: string) => {
    let attributes = rawAttributes;

    if (decoration.className) {
      const classMatch = attributes.match(/\bclass="([^"]*)"/);
      if (classMatch) {
        const merged = `${classMatch[1]} ${decoration.className}`.trim();
        attributes = attributes.replace(
          /\bclass="([^"]*)"/,
          `class="${merged}"`
        );
      } else {
        attributes += ` class="${decoration.className}"`;
      }
    }

    Object.entries(decoration.attributes ?? {}).forEach(([name, value]) => {
      if (!new RegExp(`\\b${name}=`).test(attributes)) {
        attributes += ` ${name}="${value}"`;
      }
    });

    return `<${tagName}${attributes}>`;
  });
}

function decorateRenderedTables(html: string): string {
  const decoratedTables = decorateOpeningTag(html, "table", {
    className: "smart-table",
    attributes: {
      "data-smart-table": "",
      "data-slot": "table",
    },
  });

  const wrappedTables = decoratedTables
    .replace(
      /<table\b([^>]*)>/g,
      '<div data-smart-table-shell class="smart-table-shell"><div data-smart-table-wrapper class="smart-table-wrapper table-scroll-wrapper"><table$1>'
    )
    .replace(/<\/table>/g, "</table></div></div>");

  const decorations: Array<[string, TagDecoration]> = [
    ["thead", { className: "smart-table-header", attributes: { "data-slot": "table-header" } }],
    ["tbody", { className: "smart-table-body", attributes: { "data-slot": "table-body" } }],
    ["tfoot", { className: "smart-table-footer", attributes: { "data-slot": "table-footer" } }],
    ["tr", { className: "smart-table-row", attributes: { "data-slot": "table-row" } }],
    ["th", { className: "smart-table-head-cell", attributes: { "data-slot": "table-head" } }],
    ["td", { className: "smart-table-cell", attributes: { "data-slot": "table-cell" } }],
    ["caption", { className: "smart-table-caption", attributes: { "data-slot": "table-caption" } }],
  ];

  return decorations.reduce((acc, [tagName, decoration]) => {
    return decorateOpeningTag(acc, tagName, decoration);
  }, wrappedTables);
}

/**
 * Strip .md extension from relative href values in rendered HTML so links like
 * <a href="foo.md"> resolve to the correct slug route (/foo) instead of 404ing.
 * Absolute URLs (http/https//) are left unchanged.
 */
function fixMarkdownLinks(html: string): string {
  return html.replace(/href="([^"]+\.md(?:#[^"]*)?)"/g, (_match, href) => {
    // Leave absolute URLs alone
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) {
      return `href="${href}"`;
    }
    // Strip .md before any # anchor: "path/to/file.md#section" → "path/to/file#section"
    return `href="${href.replace(/\.md(#|$)/, "$1")}"`;
  });
}

const PROXIED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".csv", ".pdf"]);

/**
 * Rewrite relative image src values to proxy through /api/file so that:
 *   - Images load in production (served from Vercel Blob via proxy)
 *   - CSP headers from blob CDN are stripped
 * Absolute URLs and data URIs are left unchanged.
 */
function fixImageSrcs(html: string, currentSlug?: string): string {
  return html.replace(/(<img\b[^>]*?\s)src="([^"]*)"([^>]*>)/g, (_match, before, src, after) => {
    // Leave absolute URLs and data URIs alone
    if (
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("//") ||
      src.startsWith("data:") ||
      src.startsWith("/api/")
    ) {
      return `${before}src="${src}"${after}`;
    }

    const ext = src.includes(".") ? src.slice(src.lastIndexOf(".")).toLowerCase() : "";
    if (!PROXIED_EXTENSIONS.has(ext)) {
      return `${before}src="${src}"${after}`;
    }

    // Resolve relative path against the current page's directory
    let resolvedPath = src;
    if (currentSlug && !src.startsWith("/")) {
      const dir = currentSlug.includes("/")
        ? currentSlug.slice(0, currentSlug.lastIndexOf("/"))
        : currentSlug;
      resolvedPath = `${dir}/${src}`;
    }

    return `${before}src="/api/file?path=${encodeURIComponent(resolvedPath)}"${after}`;
  });
}

const PDF_DOC_ICON =
  `<svg width="11" height="13" viewBox="0 0 11 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="flex-shrink:0">` +
  `<path d="M6.5 1H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4.5L6.5 1Z" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="1.1"/>` +
  `<path d="M6.5 1v3.5H10" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>` +
  `<line x1="2.5" y1="7.5" x2="8.5" y2="7.5" stroke="currentColor" stroke-width="0.7" stroke-linecap="round" opacity="0.7"/>` +
  `<line x1="2.5" y1="9.5" x2="6.5" y2="9.5" stroke="currentColor" stroke-width="0.7" stroke-linecap="round" opacity="0.5"/>` +
  `</svg>`;

const EXTERNAL_ARROW_ICON =
  `<svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="flex-shrink:0;opacity:0.65">` +
  `<path d="M1.5 7.5 7.5 1.5M4.5 1.5H7.5V4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;

/**
 * Convert PDF anchor links (href points to /api/file?path=...pdf) into styled chips.
 * Works with both wikilink-generated links and hand-written markdown links.
 * Always uses the filename (no directory, no .pdf) as the chip label for consistency.
 */
function fixPdfLinks(html: string): string {
  return html.replace(
    /<a\b([^>]*)\bhref="(\/api\/file\?path=[^"]*\.pdf[^"]*)"([^>]*)>(.*?)<\/a>/gi,
    (_match, before, href, after, innerHtml) => {
      // Don't re-wrap chips
      if (before.includes("pdf-chip") || after.includes("pdf-chip")) return _match;
      // Extract filename from the path query param — consistent regardless of wikilink label
      const rawPath = href.match(/[?&]path=([^&"]*)/)?.[1] ?? "";
      const fileName = decodeURIComponent(rawPath).split("/").pop() || innerHtml.trim();
      // Preserve any existing id/data-* attributes; strip class/target/rel (chip overrides them)
      const stripped = (before + after).replace(/\s*(class|target|rel)="[^"]*"/g, "");
      return (
        `<a${stripped} href="${href}" class="pdf-chip" target="_blank" rel="noopener noreferrer">` +
        PDF_DOC_ICON +
        `<span>${fileName}</span>` +
        EXTERNAL_ARROW_ICON +
        `</a>`
      );
    }
  );
}

// Cache dir inside .next/cache so Vercel preserves it between deploys
const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "markdown");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function hashKey(md: string): string {
  return crypto.createHash("sha256").update(`v${PIPELINE_VERSION}:${md}`).digest("hex").slice(0, 16);
}

export function renderMarkdown(md: string, currentSlug?: string): string {
  const key = hashKey(`${currentSlug ?? ""}:${md}`);
  const cachePath = path.join(CACHE_DIR, `${key}.html`);

  try {
    return fs.readFileSync(cachePath, "utf-8");
  } catch {
    // Cache miss — render and store
  }

  const mermaidExtracted = extractMermaidBlocks(md);
  const cleanMd = stripLegacyTableDirectives(mermaidExtracted);
  const raw = processor.processSync(cleanMd).toString();
  const wrapped = decorateRenderedTables(raw);
  const html = fixPdfLinks(fixImageSrcs(fixMarkdownLinks(wrapped), currentSlug));

  try {
    ensureCacheDir();
    fs.writeFileSync(cachePath, html);
  } catch {
    // Non-fatal — cache write failure doesn't break the build
  }

  return html;
}

/** Async version — uses async unified pipeline and non-blocking I/O */
export async function renderMarkdownAsync(md: string, currentSlug?: string): Promise<string> {
  const t0 = performance.now();
  const key = hashKey(`${currentSlug ?? ""}:${md}`);
  const cachePath = path.join(CACHE_DIR, `${key}.html`);

  try {
    const cached = await fs.promises.readFile(cachePath, "utf-8");
    console.log(`[perf] renderMarkdown cache-hit slug=${currentSlug} ${(performance.now() - t0).toFixed(1)}ms`);
    return cached;
  } catch {
    // Cache miss — render and store
  }

  const t1 = performance.now();
  const mermaidExtracted = extractMermaidBlocks(md);
  const tMermaid = performance.now();

  const cleanMd = stripLegacyTableDirectives(mermaidExtracted);
  const raw = (await processor.process(cleanMd)).toString();
  const tPipeline = performance.now();

  const wrapped = decorateRenderedTables(raw);
  const html = fixPdfLinks(fixImageSrcs(fixMarkdownLinks(wrapped), currentSlug));

  console.log(
    `[perf] renderMarkdown cache-miss slug=${currentSlug} ` +
    `mermaid=${(tMermaid - t1).toFixed(1)}ms pipeline=${(tPipeline - tMermaid).toFixed(1)}ms ` +
    `total=${(performance.now() - t0).toFixed(1)}ms`
  );

  try {
    ensureCacheDir();
    await fs.promises.writeFile(cachePath, html);
  } catch {
    // Non-fatal — cache write failure doesn't break the build
  }

  return html;
}
