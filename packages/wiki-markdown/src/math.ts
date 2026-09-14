import rehypeKatex from "rehype-katex";
import { markdownRehypePlugins as basePlugins } from "./math-common";
export * from "./math-common";
export const markdownRehypePlugins = [...basePlugins, rehypeKatex];
