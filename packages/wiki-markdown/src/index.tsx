"use client";
import { memo, useMemo } from "react";
import { WikiMarkdownRenderer, type WikiMarkdownProps } from "./renderer";
import { markdownRehypePlugins } from "./math";
import { SlidesViewer } from "./slides-viewer";
export * from "./renderer";
export { SlidesViewer, SlidesViewerControls } from "./slides-viewer";
export { toPortableMarkdown } from "./portable.ts";
export { markdownRehypePlugins } from "./math";

// Preserve the synchronous renderer for SSR and existing package consumers.
export const WikiMarkdown = memo(function WikiMarkdown(props: WikiMarkdownProps) {
  const mdxComponents = useMemo(() => ({ SlidesViewer, ...props.mdxComponents }), [props.mdxComponents]);
  return <WikiMarkdownRenderer {...props} mdxComponents={mdxComponents} rehypePlugins={markdownRehypePlugins} />;
});

export type { ScenarioWalkthroughProps, ScenarioWaterfallProps } from "./scenario-waterfall.tsx";
