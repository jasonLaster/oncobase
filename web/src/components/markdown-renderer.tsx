import { resolveWikilinks } from "@/lib/wikilinks";
import { renderMarkdown } from "@/lib/render-markdown";
import { InteractiveTables } from "@/components/interactive-tables";

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
  const html = renderMarkdown(resolved);

  return (
    <div className="prose max-w-none">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <InteractiveTables disableAnchors={disableAnchors} />
    </div>
  );
}
