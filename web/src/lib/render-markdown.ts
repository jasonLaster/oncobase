import fs from "fs";
import path from "path";
import crypto from "crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { renderMermaidSVG } from "beautiful-mermaid";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSlug)
  .use(rehypeStringify);

// Bump this when the remark/rehype pipeline changes to invalidate cached HTML
const PIPELINE_VERSION = "12";

// ─── Mermaid theme ────────────────────────────────────────────────────────────
// Matches the site's light-mode design tokens from globals.css
const MERMAID_THEME = {
  bg: "#ffffff",
  fg: "#1a1a2e",
  accent: "#4f46e5",
  line: "#9ca3af",
  border: "#e5e7eb",
  surface: "#f0f4ff",
  muted: "#6b7280",
};

// ─── Mermaid pre-processor ────────────────────────────────────────────────────
//
// Renders ```mermaid fenced code blocks to SVG server-side using beautiful-mermaid.
// Output: <div class="mermaid-diagram"><svg ...></svg></div>

function extractMermaidBlocks(md: string): string {
  return md.replace(/^```mermaid\r?\n([\s\S]*?)^```/gm, (_match, graph: string) => {
    try {
      const svg = renderMermaidSVG(graph.trimEnd(), MERMAID_THEME);
      return `<div class="mermaid-diagram">${svg}</div>`;
    } catch (err) {
      console.warn("Mermaid render error:", err);
      const escaped = graph.trimEnd().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<pre class="mermaid-error text-sm text-red-500 font-mono my-4 p-3 border border-red-200 rounded">${escaped}</pre>`;
    }
  });
}

// ─── Table column width directives ───────────────────────────────────────────
//
// Syntax (in any .md file, on its own line before a table, blank line allowed):
//   <!-- table-cols: 260, 120, 60, 150, 200 -->
//
// Values without units are treated as pixels. Any CSS length works (e.g. 30ch).
//
// HTML comments are stripped by the remark/rehype pipeline, so we pre-scan the
// raw markdown and remember which table ordinal each directive targets, then
// inject <colgroup> elements into the rendered HTML afterwards.

interface TableDirective {
  tableOrdinal: number; // 0-based index of the table this applies to
  cols: string[];
}

function parseTableDirectives(md: string): { directives: TableDirective[]; cleanMd: string } {
  const directives: TableDirective[] = [];
  let tableCount = 0;

  const lines = md.split("\n");
  const cleanLines: string[] = [];
  let pendingCols: string[] | null = null;
  let inTable = false; // track whether previous line was a table row

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect directive
    const directiveMatch = trimmed.match(/^<!--\s*table-cols:\s*(.*?)-->\s*$/);
    if (directiveMatch) {
      pendingCols = directiveMatch[1].split(",").map((w: string) => {
        const v = w.trim();
        return /^\d+$/.test(v) ? `${v}px` : v;
      });
      inTable = false;
      // Strip directive from cleaned markdown (don't emit it)
      continue;
    }

    // Detect markdown table row (pipe-delimited)
    if (trimmed.startsWith("|")) {
      if (!inTable) {
        // First row of a new table block
        if (pendingCols) {
          directives.push({ tableOrdinal: tableCount, cols: pendingCols });
          pendingCols = null;
        }
        tableCount++;
        inTable = true;
      }
      cleanLines.push(line);
      continue;
    }

    // Leaving a table block
    inTable = false;

    // Empty lines don't cancel a pending directive (allow blank line between directive and table)
    if (trimmed === "") {
      cleanLines.push(line);
      continue;
    }

    // Any other non-empty content cancels the pending directive
    pendingCols = null;
    cleanLines.push(line);
  }

  return { directives, cleanMd: cleanLines.join("\n") };
}

function injectColgroups(html: string, directives: TableDirective[]): string {
  if (directives.length === 0) return html;

  const directiveMap = new Map(directives.map((d) => [d.tableOrdinal, d.cols]));
  let tableIndex = 0;

  return html.replace(/<table(?:[^>]*)>/g, (tableTag) => {
    const cols = directiveMap.get(tableIndex++);
    if (!cols) return tableTag;
    const colgroup = `<colgroup>${cols.map((w: string) => `<col style="min-width:${w};width:${w}">`).join("")}</colgroup>`;
    return `${tableTag}${colgroup}`;
  });
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
  const { directives, cleanMd } = parseTableDirectives(mermaidExtracted);
  const raw = processor.processSync(cleanMd).toString();
  // Wrap every table in a scroll container so horizontal scroll works before JS hydrates.
  const wrapped = raw.replace(/<table/g, '<div class="table-scroll-wrapper"><table').replace(/<\/table>/g, "</table></div>");
  const html = fixPdfLinks(injectColgroups(fixImageSrcs(fixMarkdownLinks(wrapped), currentSlug), directives));

  try {
    ensureCacheDir();
    fs.writeFileSync(cachePath, html);
  } catch {
    // Non-fatal — cache write failure doesn't break the build
  }

  return html;
}
