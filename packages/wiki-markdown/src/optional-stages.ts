import { mayContainMath, preloadMarkdownMath } from "./math-loader.ts";
import { prepareWikiMarkdown } from "./prepare.ts";
import { mayContainRawHtml, preloadRawHtml } from "./raw-html-loader.ts";

/**
 * Loads the optional pipeline stages (math, raw HTML) that `WikiMarkdown`
 * (browser.tsx) would wait for with these exact props, using its own two
 * checks. That component loads them in effects, which never run on the
 * server: a server render must await this first, or it renders the loading
 * fallback instead of the document, and a hydrating client must too, or its
 * first render differs from the server's.
 */
export async function preloadOptionalMarkdownStages(content: string, currentSlug?: string, apiBasePath = "") {
  const prepared = prepareWikiMarkdown(content, currentSlug, apiBasePath);
  await Promise.all([
    mayContainMath(content) ? preloadMarkdownMath() : null,
    mayContainRawHtml(prepared) ? preloadRawHtml() : null,
  ]);
}
