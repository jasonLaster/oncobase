import { preprocessCitationMarkdown } from "./citations.ts";
import { protectCurrencyFromMath } from "./math-common.ts";
import { resolveWikilinks } from "./paths.ts";
import { isolateDirectiveLines } from "./remark-layout.ts";
import { expandSlidesMarkdown } from "./slides-markdown.ts";
import { expandWikiMdx } from "./mdx-components.ts";

/** The markdown the renderer parses: MDX components expanded to placeholders, wikilinks resolved, citations and slides
 * expanded (both write HTML), currency protected from math, directive lines isolated from lazy continuation. */
export function prepareWikiMarkdown(content: string, currentSlug: string | undefined, apiBasePath: string) {
  return isolateDirectiveLines(
    protectCurrencyFromMath(
      expandSlidesMarkdown(
        preprocessCitationMarkdown(
          resolveWikilinks(expandWikiMdx(content), currentSlug, apiBasePath),
        ),
      ),
    ),
  );
}
