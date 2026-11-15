import { preprocessCitationMarkdown } from "./citations.ts";
import { protectCurrencyFromMath } from "./math-common.ts";
import { resolveWikilinks } from "./paths.ts";
import { expandSlidesMarkdown } from "./slides-markdown.ts";

/** The markdown the renderer parses: wikilinks resolved, citations and slides
 * expanded (both write HTML), currency protected from math. */
export function prepareWikiMarkdown(content: string, currentSlug: string | undefined, apiBasePath: string) {
  return protectCurrencyFromMath(
    expandSlidesMarkdown(
      preprocessCitationMarkdown(
        resolveWikilinks(content, currentSlug, apiBasePath),
      ),
    ),
  );
}
