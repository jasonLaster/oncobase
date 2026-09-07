import { Buffer } from "node:buffer";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { preprocessCitationMarkdown } from "./citations.ts";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
  protectCurrencyFromMath,
} from "./math.ts";
import { expandSlidesMarkdown } from "./slides-markdown.ts";
import { resolveWikilinks } from "./paths.ts";
import { formatWikiHtml } from "./server-format.ts";

const processor = unified()
  .use(remarkParse)
  .use(markdownRemarkPlugins)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(markdownRehypePlugins)
  .use(rehypeSlug)
  .use(rehypeStringify);

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
      const encoded = Buffer.from(src, "utf-8").toString("base64");
      return `<div class="mermaid-placeholder" data-graph="${encoded}"></div>`;
    }
  });
}

function stripLegacyTableDirectives(md: string): string {
  return md.replace(/^\s*<!--\s*table-cols:\s*.*?-->\s*$/gm, "");
}


export function renderWikiMarkdownHtml(md: string, currentSlug?: string): string {
  const citationLinked = preprocessCitationMarkdown(resolveWikilinks(md, currentSlug));
  const slidesExpanded = expandSlidesMarkdown(citationLinked);
  const mermaidExtracted = extractMermaidBlocks(slidesExpanded);
  const cleanMd = protectCurrencyFromMath(
    stripLegacyTableDirectives(mermaidExtracted),
  );
  const raw = processor.processSync(cleanMd).toString();
  return formatWikiHtml(raw, currentSlug);
}

export async function renderWikiMarkdownHtmlAsync(
  md: string,
  currentSlug?: string,
): Promise<string> {
  const citationLinked = preprocessCitationMarkdown(resolveWikilinks(md, currentSlug));
  const slidesExpanded = expandSlidesMarkdown(citationLinked);
  const mermaidExtracted = extractMermaidBlocks(slidesExpanded);
  const cleanMd = protectCurrencyFromMath(
    stripLegacyTableDirectives(mermaidExtracted),
  );
  const raw = (await processor.process(cleanMd)).toString();
  return formatWikiHtml(raw, currentSlug);
}
