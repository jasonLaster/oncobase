import rehypeKatex from "rehype-katex";
import { markdownRehypePlugins as basePlugins } from "./rehype-plugins";
export * from "./math-common";
export const markdownRehypePlugins = [...basePlugins, rehypeKatex];
