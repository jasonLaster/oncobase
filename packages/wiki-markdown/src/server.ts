import { Buffer } from "node:buffer";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { preprocessCitationMarkdown } from "./citations.ts";
import { parseFigureSpec } from "./figure-spec.ts";
import { renderFigureStaticHtml } from "./figure-svg.ts";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
  protectCurrencyFromMath,
} from "./math.ts";
import { fixMermaidSvgContrast } from "./mermaid-contrast.ts";
import { expandSlidesMarkdown } from "./slides-markdown.ts";
import { expandWikiMdx } from "./mdx-components.ts";
import { resolveWikilinks } from "./paths.ts";
import { isolateDirectiveLines } from "./remark-layout.ts";
import { formatWikiHtml, type WikiHtmlAdapters } from "./server-format.ts";
export type { WikiHtmlAdapters } from "./server-format.ts";

const processor = unified()
  .use(remarkParse)
  .use(markdownRemarkPlugins)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(markdownRehypePlugins)
  .use(rehypeSlug)
  .use(rehypeStringify);

function extractMermaidBlocks(md: string, options?: WikiHtmlAdapters["mermaidOptions"]): string {
  return md.replace(/^```mermaid\r?\n([\s\S]*?)^```/gm, (_match, graph: string) => {
    const src = graph.trimEnd();
    try {
      if (options) {
        // Theme colours are CSS variables here, so label text is unknown at
        // build time: give every authored fill its readable label colour.
        return `<div class="mermaid-diagram">${fixMermaidSvgContrast(renderMermaidSVG(src, options))}</div>`;
      }
      const light = THEMES["github-light"];
      const dark = THEMES["github-dark"];
      const svgLight = fixMermaidSvgContrast(renderMermaidSVG(src, light), light.fg);
      const svgDark = fixMermaidSvgContrast(renderMermaidSVG(src, dark), dark.fg);
      return (
        `<div class="mermaid-diagram dark:hidden">${svgLight}</div>` +
        `<div class="mermaid-diagram hidden dark:block">${svgDark}</div>`
      );
    } catch (err) {
      console.warn("Mermaid render error:", err);
      const encoded = Buffer.from(src, "utf-8").toString("base64");
      return `<div class="mermaid-placeholder" data-graph="${encoded}"></div>`;
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractFigureBlocks(md: string): { markdown: string; figures: string[] } {
  const figures: string[] = [];
  if (!md.includes("```figure")) return { markdown: md, figures };
  const markdown = md.replace(/^```figure[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm, (_match, body: string) => {
    const source = body.trimEnd();
    const parsed = parseFigureSpec(source);
    const html = parsed.ok
      ? renderFigureStaticHtml(parsed.spec)
      : `<figure class="wiki-data-figure wiki-data-figure--error" data-test-id="wiki-figure">` +
        `<figcaption class="wiki-data-figure__caption">Figure could not be rendered: ${escapeHtml(parsed.error)}</figcaption>` +
        `<pre><code>${escapeHtml(source)}</code></pre></figure>`;
    const index = figures.length;
    figures.push(html);
    return `\n<div data-wiki-figure-slot="${index}"></div>\n`;
  });
  return { markdown, figures };
}

function restoreFigureBlocks(html: string, figures: string[]): string {
  if (figures.length === 0) return html;
  return html.replace(/<div data-wiki-figure-slot="(\d+)"><\/div>/g, (match, index: string) => {
    return figures[Number(index)] ?? match;
  });
}

function stripLegacyTableDirectives(md: string): string {
  return md.replace(/^\s*<!--\s*table-cols:\s*.*?-->\s*$/gm, "");
}

export function renderWikiMarkdownHtml(md: string, currentSlug?: string, adapters?: WikiHtmlAdapters): string {
  const citationLinked = preprocessCitationMarkdown(resolveWikilinks(expandWikiMdx(md), currentSlug));
  const slidesExpanded = expandSlidesMarkdown(citationLinked);
  const { markdown: figuresExtracted, figures } = extractFigureBlocks(slidesExpanded);
  const mermaidExtracted = extractMermaidBlocks(figuresExtracted, adapters?.mermaidOptions);
  const cleanMd = isolateDirectiveLines(
    protectCurrencyFromMath(
      stripLegacyTableDirectives(mermaidExtracted),
    ),
  );
  const raw = processor.processSync(cleanMd).toString();
  return restoreFigureBlocks(formatWikiHtml(raw, currentSlug, adapters), figures);
}

export async function renderWikiMarkdownHtmlAsync(
  md: string,
  currentSlug?: string,
  adapters?: WikiHtmlAdapters,
): Promise<string> {
  const citationLinked = preprocessCitationMarkdown(resolveWikilinks(expandWikiMdx(md), currentSlug));
  const slidesExpanded = expandSlidesMarkdown(citationLinked);
  const { markdown: figuresExtracted, figures } = extractFigureBlocks(slidesExpanded);
  const mermaidExtracted = extractMermaidBlocks(figuresExtracted, adapters?.mermaidOptions);
  const cleanMd = isolateDirectiveLines(
    protectCurrencyFromMath(
      stripLegacyTableDirectives(mermaidExtracted),
    ),
  );
  const raw = (await processor.process(cleanMd)).toString();
  return restoreFigureBlocks(formatWikiHtml(raw, currentSlug, adapters), figures);
}
