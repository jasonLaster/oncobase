import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { resolveWikilinks } from "@/lib/wikilinks";

export function MarkdownRenderer({ content }: { content: string }) {
  const resolved = resolveWikilinks(content);

  return (
    <div className="prose max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {resolved}
      </ReactMarkdown>
    </div>
  );
}
