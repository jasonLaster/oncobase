import rehypeRaw from "rehype-raw";
import { markdownRehypeTailPlugins } from "./math-common.ts";

/** The full rehype list: raw HTML parsed by rehype-raw (parse5), then slugs.
 * Synchronous consumers (SSR, search snippets) use this one. */
export const markdownRehypePlugins = [rehypeRaw, ...markdownRehypeTailPlugins];
