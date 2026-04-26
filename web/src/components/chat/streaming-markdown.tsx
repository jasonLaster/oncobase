"use client";

/**
 * Streaming-aware markdown renderer for chat assistant messages.
 *
 * Streamdown is now the default. The legacy MarkdownRendererClient remains
 * available as a fallback when NEXT_PUBLIC_CHAT_STREAMDOWN=0 (e.g. during
 * a markdown-gallery audit), but the chat hot path always uses Streamdown.
 *
 * Wikilink and citation preprocessing remain string-based — they run on the
 * markdown source before Streamdown sees it, exactly as they did with
 * react-markdown.
 *
 * PR 28 review — Streamdown hardening:
 *   - `isStreaming` toggles `mode="streaming"` (with a caret) vs `mode="static"`
 *     for completed assistant rows. Static mode disables animation hooks and
 *     keeps the rendered DOM stable once a message is finalized.
 *   - `skipHtml` is enabled and `rehype-raw` is dropped from this renderer's
 *     pipeline so raw HTML in model output is rendered as text. The shared
 *     `markdownRehypePlugins` still includes rehype-raw for trusted wiki
 *     content; chat substitutes a chat-only list here.
 *   - `controls={false}` disables the table/code/mermaid copy/download
 *     overlays that Streamdown ships by default — chat assistant rows have
 *     their own copy/regenerate actions and the overlays add visual noise.
 */

import { Streamdown, type Components as StreamdownComponents } from "streamdown";
import rehypeKatex from "rehype-katex";
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

// Default ON. Override to "0" only for the legacy fallback during audit.
const STREAMDOWN_DISABLED = process.env.NEXT_PUBLIC_CHAT_STREAMDOWN === "0";

// Chat-only rehype pipeline. We deliberately drop rehype-raw so any raw HTML
// the model emits is rendered as text (combined with Streamdown's `skipHtml`).
// rehype-katex is still required for inline / block math.
const chatRehypePlugins = [rehypeKatex];

export function StreamingMarkdown({
  content,
  disableAnchors,
  isStreaming = false,
}: {
  content: string;
  disableAnchors?: boolean;
  /**
   * True for the assistant row that is currently receiving tokens. Drives
   * Streamdown into `mode="streaming"` with a caret. Completed rows render
   * in `mode="static"`.
   */
  isStreaming?: boolean;
}) {
  if (STREAMDOWN_DISABLED) {
    return (
      <MarkdownRendererClient content={content} disableAnchors={disableAnchors} />
    );
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
