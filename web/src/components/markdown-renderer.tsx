import { resolveWikilinks } from "@/lib/wikilinks";
import { renderMarkdown, renderMarkdownAsync } from "@/lib/render-markdown";
import { MarkdownHeadingAnchors } from "@/components/markdown-heading-anchors";
import { MermaidRenderer } from "@/components/mermaid-renderer";
import { InteractiveTables } from "@/components/interactive-tables";
import { ImageTheater } from "@/components/image-theater";
import { cacheLife, cacheTag } from "next/cache";
import {
  siteCacheTag,
  siteDocCacheTag,
  siteRenderCacheTag,
} from "@/lib/wiki-cache-tags";

type MarkdownRendererProps = {
  content: string;
  currentSlug?: string;
  disableAnchors?: boolean;
  anchorScopeKey?: string;
  siteSlug?: string;
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

async function renderCachedMarkdownHtml({
  content,
  currentSlug,
  siteSlug,
}: {
  content: string;
  currentSlug?: string;
  siteSlug?: string;
}) {
  "use cache";
  cacheLife("weeks");
  if (siteSlug) {
    cacheTag(
      siteCacheTag(siteSlug),
      siteRenderCacheTag(siteSlug),
      ...(currentSlug ? [siteDocCacheTag(siteSlug, currentSlug)] : []),
    );
  }

  const resolved = resolveWikilinks(content, currentSlug);
  return await renderMarkdownAsync(resolved, currentSlug);
}

/** Async RSC version — non-blocking I/O, lets other work proceed during rendering */
export async function MarkdownRendererAsync({
  content,
  currentSlug,
  disableAnchors,
  anchorScopeKey,
  siteSlug,
}: MarkdownRendererProps) {
  const html = await renderCachedMarkdownHtml({
    content,
    currentSlug,
    siteSlug,
  });

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
