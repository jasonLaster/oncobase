import { resolveWikilinks } from "@/lib/wikilinks";
import { renderMarkdown, renderMarkdownAsync } from "@/lib/render-markdown";
import { renderCachedMarkdownHtmlForSite } from "@/lib/markdown-render-cache";
import { MarkdownHeadingAnchors } from "@/components/markdown-heading-anchors";
import { MermaidRenderer } from "@/components/mermaid-renderer";
import { InteractiveTables } from "@/components/interactive-tables";
import { ImageTheater } from "@/components/image-theater";

type MarkdownRendererProps = {
  content: string;
  currentSlug?: string;
  disableAnchors?: boolean;
  anchorScopeKey?: string;
  siteSlug?: string;
  contentHash?: string | null;
};

export function MarkdownRenderer({
  content,
  currentSlug,
  disableAnchors,
  anchorScopeKey,
}: MarkdownRendererProps) {
  const resolved = resolveWikilinks(content, currentSlug);
  const html = renderMarkdown(resolved, currentSlug);

  return (
    <div className="prose max-w-none">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownHeadingAnchors
        disableAnchors={disableAnchors}
        scopeKey={anchorScopeKey ?? currentSlug}
      />
      <InteractiveTables />
      <MermaidRenderer />
      <ImageTheater />
    </div>
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
}: MarkdownRendererProps) {
  const html =
    siteSlug && currentSlug
      ? await renderCachedMarkdownHtmlForSite({
          siteSlug,
          slug: currentSlug,
          contentHash,
          content,
        })
      : await renderMarkdownAsync(resolveWikilinks(content, currentSlug), currentSlug);

  return (
    <div className="prose max-w-none">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownHeadingAnchors
        disableAnchors={disableAnchors}
        scopeKey={anchorScopeKey ?? currentSlug}
      />
      <InteractiveTables />
      <MermaidRenderer />
      <ImageTheater />
    </div>
  );
}
