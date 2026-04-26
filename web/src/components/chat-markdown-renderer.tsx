"use client";

import { Streamdown, type Components as StreamdownComponents } from "streamdown";
import rehypeKatex from "rehype-katex";
import type { ChatMarkdownRendererProps } from "@diana-tnbc/chat";
import {
  MdTable,
  MdTbody,
  MdTd,
  MdTh,
  MdThead,
  MdTr,
} from "@/components/markdown-table";
import { resolveWikilinks } from "@/lib/wikilinks";
import { markdownRemarkPlugins } from "@/lib/markdown-math";
import { preprocessCitationMarkdown } from "@/lib/citation-links";
import { MarkdownRendererClient } from "@/components/markdown-renderer-client";

const STREAMDOWN_DISABLED = process.env.NEXT_PUBLIC_CHAT_STREAMDOWN === "0";
const chatRehypePlugins = [rehypeKatex];

export function DianaChatMarkdownRenderer({
  content,
  disableAnchors,
  isStreaming = false,
}: ChatMarkdownRendererProps) {
  if (STREAMDOWN_DISABLED) {
    return (
      <MarkdownRendererClient content={content} disableAnchors={disableAnchors} />
    );
  }

  const resolved = resolveWikilinks(content);
  const citationLinked = preprocessCitationMarkdown(resolved);
  const components = {
    table: MdTable,
    thead: MdThead,
    tbody: MdTbody,
    tr: MdTr,
    th: MdTh,
    td: MdTd,
  } as unknown as StreamdownComponents;

  return (
    <div className="prose max-w-none">
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        caret={isStreaming ? "block" : undefined}
        skipHtml
        controls={false}
        parseIncompleteMarkdown={isStreaming}
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={chatRehypePlugins}
        components={components}
      >
        {citationLinked}
      </Streamdown>
    </div>
  );
}
