"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";
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
import { RoutedAnchorLinks } from "@/components/markdown-heading-anchors";

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
    a: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (href?.startsWith("/")) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }

      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
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
      <RoutedAnchorLinks />
    </div>
  );
}
