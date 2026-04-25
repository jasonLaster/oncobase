"use client";

/**
 * Streaming-aware markdown renderer for chat assistant messages. Phase 5 of
 * the chat-performance plan.
 *
 * Gated behind NEXT_PUBLIC_CHAT_STREAMDOWN=1. When the flag is unset, the
 * component falls back to the existing MarkdownRendererClient so we can ship
 * Streamdown progressively (visual regression + math edge cases first).
 *
 * Wikilink and citation preprocessing remain string-based — they run on the
 * markdown source before Streamdown sees it, exactly as they did with
 * react-markdown.
 */

import { Streamdown, type Components as StreamdownComponents } from "streamdown";
import {
  MdTable,
  MdTbody,
  MdTd,
  MdTh,
  MdThead,
  MdTr,
} from "@/components/markdown-table";
import { resolveWikilinks } from "@/lib/wikilinks";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
} from "@/lib/markdown-math";
import { preprocessCitationMarkdown } from "@/lib/citation-links";
import { MarkdownRendererClient } from "@/components/markdown-renderer-client";

const STREAMDOWN_ENABLED =
  process.env.NEXT_PUBLIC_CHAT_STREAMDOWN === "1";

export function StreamingMarkdown({
  content,
  disableAnchors,
}: {
  content: string;
  disableAnchors?: boolean;
}) {
  if (!STREAMDOWN_ENABLED) {
    return <MarkdownRendererClient content={content} disableAnchors={disableAnchors} />;
  }

  const resolved = resolveWikilinks(content);
  const citationLinked = preprocessCitationMarkdown(resolved);

  // Streamdown's `Components` type is structurally identical to react-markdown's
  // but TS can't see it through the conditional `inlineCode` field — cast.
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
        parseIncompleteMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {citationLinked}
      </Streamdown>
    </div>
  );
}
