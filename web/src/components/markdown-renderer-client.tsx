"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { resolveWikilinks } from "@/lib/wikilinks";

/**
 * Client-side markdown renderer for interactive contexts (chat, search)
 * where content streams in and server rendering isn't practical.
 * For static wiki pages, use the server-side MarkdownRenderer instead.
 */
export function MarkdownRendererClient({
  content,
}: {
  content: string;
  disableAnchors?: boolean;
}) {
  const resolved = resolveWikilinks(content);

  return (
    <div className="prose max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {resolved}
      </ReactMarkdown>
    </div>
  );
}
