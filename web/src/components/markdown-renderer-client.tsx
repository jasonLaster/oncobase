"use client";

import ReactMarkdown from "react-markdown";
import {
  MdTable,
  MdTbody,
  MdTd,
  MdTh,
  MdThead,
  MdTr,
} from "@/components/markdown-table";
import { resolveWikilinks } from "@/lib/wikilinks";
import { MarkdownHeadingAnchors } from "@/components/markdown-heading-anchors";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
} from "@/lib/markdown-math";

/**
 * Client-side markdown renderer for interactive contexts (chat, search)
 * where content streams in and server rendering isn't practical.
 * For static wiki pages, use the server-side MarkdownRenderer instead.
 */
export function MarkdownRendererClient({
  content,
  disableAnchors,
}: {
  content: string;
  disableAnchors?: boolean;
}) {
  const resolved = resolveWikilinks(content);

  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={{
          table: MdTable,
          thead: MdThead,
          tbody: MdTbody,
          tr: MdTr,
          th: MdTh,
          td: MdTd,
        }}
      >
        {resolved}
      </ReactMarkdown>
      <MarkdownHeadingAnchors disableAnchors={disableAnchors} />
    </div>
  );
}
