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

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSlug)
  .use(rehypeStringify);

// Bump this when the remark/rehype pipeline changes to invalidate cached HTML
const PIPELINE_VERSION = "6";

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

  const { directives, cleanMd } = parseTableDirectives(md);
  const raw = processor.processSync(cleanMd).toString();
  // Wrap every table in a scroll container so horizontal scroll works before JS hydrates.
  const wrapped = raw.replace(/<table/g, '<div class="table-scroll-wrapper"><table').replace(/<\/table>/g, "</table></div>");
  const html = injectColgroups(fixImageSrcs(fixMarkdownLinks(wrapped), currentSlug), directives);

  try {
    ensureCacheDir();
    fs.writeFileSync(cachePath, html);
  } catch {
    // Non-fatal — cache write failure doesn't break the build
  }

  return html;
}
