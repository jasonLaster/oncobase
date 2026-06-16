import { resolveWikilinks } from "@/lib/wikilinks";
import { renderMarkdown, renderMarkdownAsync } from "@/lib/render-markdown";
import type { PiiRedactionMode } from "@/lib/pii-redaction";
import { WikiMarkdownFrame } from "@oncobase/wiki-markdown/frame";
import { renderCachedMarkdownHtmlForSite } from "@/lib/markdown-render-cache";
import { MarkdownHeadingAnchors } from "@/components/markdown-heading-anchors";
import { MermaidRenderer } from "@/components/mermaid-renderer";
import { InteractiveTables } from "@/components/interactive-tables";
import { ImageTheater } from "@/components/image-theater";
import { SlidesViewerControls } from "@/components/slides-viewer";

type MarkdownRendererProps = {
  content: string;
  currentSlug?: string;
  disableAnchors?: boolean;
  anchorScopeKey?: string;
  siteSlug?: string;
  contentHash?: string | null;
  includeSensitive?: boolean;
  redactionMode?: PiiRedactionMode;
};

type MarkdownRendererAsyncProps = Omit<MarkdownRendererProps, "content"> & {
  content?: string;
};

export function MarkdownRenderer({
  content,
  currentSlug,
  disableAnchors,
  anchorScopeKey,
  redactionMode,
}: MarkdownRendererProps) {
  const resolved = resolveWikilinks(content, currentSlug);
  const html = renderMarkdown(resolved, currentSlug, { redactionMode });

  return (
    <WikiMarkdownFrame>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownHeadingAnchors
        disableAnchors={disableAnchors}
        scopeKey={anchorScopeKey ?? currentSlug}
      />
      <InteractiveTables />
      <MermaidRenderer />
      <SlidesViewerControls />
      <ImageTheater />
    </WikiMarkdownFrame>
  );
}

/** Async RSC version — non-blocking I/O, lets other work proceed during rendering */
export async function MarkdownRendererAsync({
  content,
  currentSlug,
  disableAnchors,
  anchorScopeKey,
  siteSlug,
  contentHash,
  includeSensitive,
  redactionMode,
}: MarkdownRendererAsyncProps) {
  if (!contentHash && content == null) {
    throw new Error("MarkdownRendererAsync requires content when contentHash is missing");
  }

  const html =
    siteSlug && currentSlug
      ? await renderCachedMarkdownHtmlForSite({
          siteSlug,
          slug: currentSlug,
          contentHash,
          content,
          includeSensitive,
          redactionMode,
        })
      : await renderMarkdownAsync(resolveWikilinks(content ?? "", currentSlug), currentSlug, {
          redactionMode,
        });

  return (
    <WikiMarkdownFrame>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownHeadingAnchors
        disableAnchors={disableAnchors}
        scopeKey={anchorScopeKey ?? currentSlug}
      />
      <InteractiveTables />
      <MermaidRenderer />
      <SlidesViewerControls />
      <ImageTheater />
    </WikiMarkdownFrame>
  );
}
