"use client";

/**
 * Generic streaming-aware markdown renderer for chat assistant messages.
 *
 * Host apps can provide a richer renderer through <ChatRuntimeProvider>.
 * The Diana web app does that for Obsidian wikilinks, citations, math, and
 * smart-table rendering. This default intentionally has no host-specific
 * markdown transforms.
 */

import { Streamdown } from "streamdown";
import type { ChatMarkdownRendererProps } from "../types";

export function StreamingMarkdown({
  content,
  disableAnchors,
  isStreaming = false,
}: ChatMarkdownRendererProps) {
  return (
    <div className="prose max-w-none">
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        caret={isStreaming ? "block" : undefined}
        skipHtml
        controls={false}
        parseIncompleteMarkdown={isStreaming}
      >
        {content}
      </Streamdown>
    </div>
  );
}
