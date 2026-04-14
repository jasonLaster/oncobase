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
const PIPELINE_VERSION = "2";

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

export function renderMarkdown(md: string): string {
  const key = hashKey(md);
  const cachePath = path.join(CACHE_DIR, `${key}.html`);

  try {
    return fs.readFileSync(cachePath, "utf-8");
  } catch {
    // Cache miss — render and store
  }

  const raw = processor.processSync(md).toString();
  const html = fixMarkdownLinks(raw);

  try {
    ensureCacheDir();
    fs.writeFileSync(cachePath, html);
  } catch {
    // Non-fatal — cache write failure doesn't break the build
  }

  return html;
}
