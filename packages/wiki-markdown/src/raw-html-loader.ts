import type rehypeRaw from "rehype-raw";
import { preprocessCitationMarkdown } from "./citations.ts";
import { mayContainRawHtml } from "./raw-html.ts";
import { expandSlidesMarkdown } from "./slides-markdown.ts";
import { expandWikiMdx } from "./mdx-components.ts";

type RawHtmlPlugin = typeof rehypeRaw;
let loaded: RawHtmlPlugin | undefined;
let pending: Promise<RawHtmlPlugin> | undefined;

export { mayContainRawHtml };
export function loadedRawHtmlPlugin() { return loaded; }
export function preloadRawHtml() {
  return pending ??= import("rehype-raw").then(module => (loaded = module.default));
}

/** For boot code that holds a page's markdown before the renderer runs: true
 * when the document will wait for the raw-HTML stage (the citation and slides
 * preprocessors write HTML too). A hint only; the renderer decides on the
 * fully prepared markdown. Dependency-free, so it costs boot code nothing. */
export function documentMayNeedRawHtml(content: string) {
  return mayContainRawHtml(expandSlidesMarkdown(preprocessCitationMarkdown(expandWikiMdx(content))));
}
