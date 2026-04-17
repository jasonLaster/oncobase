import { resolveWikilinks } from "@/lib/wikilinks";
import { renderMarkdown, renderMarkdownAsync } from "@/lib/render-markdown";
import { InteractiveTables } from "@diana-tnbc/smart-table";
import { MarkdownHeadingAnchors } from "@/components/markdown-heading-anchors";

export function MarkdownRenderer({
  content,
  currentSlug,
  disableAnchors,
}: {
  content: string;
  currentSlug?: string;
  disableAnchors?: boolean;
}) {
  const resolved = resolveWikilinks(content, currentSlug);
  const html = renderMarkdown(resolved, currentSlug);

  return (
    <div className="prose max-w-none">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownHeadingAnchors disableAnchors={disableAnchors} />
      <InteractiveTables />
    </div>
  );
}

/** Async RSC version — non-blocking I/O, lets other work proceed during rendering */
export async function MarkdownRendererAsync({
  content,
  currentSlug,
  disableAnchors,
}: {
  content: string;
  currentSlug?: string;
  disableAnchors?: boolean;
}) {
  const resolved = resolveWikilinks(content, currentSlug);
  const html = await renderMarkdownAsync(resolved, currentSlug);

  return (
    <div className="prose max-w-none">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownHeadingAnchors disableAnchors={disableAnchors} />
      <InteractiveTables />
    </div>
  );
}
