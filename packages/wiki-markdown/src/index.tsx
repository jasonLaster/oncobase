"use client";
import { memo } from "react";
import { WikiMarkdownRenderer, type WikiMarkdownProps } from "./renderer";
import { markdownRehypePlugins } from "./math";
export * from "./renderer";
export { markdownRehypePlugins } from "./math";

// Preserve the synchronous renderer for SSR and existing package consumers.
export const WikiMarkdown = memo(function WikiMarkdown(props: WikiMarkdownProps) {
  return <WikiMarkdownRenderer {...props} rehypePlugins={markdownRehypePlugins} />;
});
